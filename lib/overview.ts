// 上传后自动概览：识别分类字段并跑聚合查询，生成「数据长什么样」的总览
// 无需 LLM，纯本地 DuckDB 计算，快速给用户一个数据画像

import { describeTable, runQuery } from './duckdb';
import type { TableMeta, QueryResult } from './duckdb';

export interface OverviewResult {
  meta: TableMeta;
  /** 概览文字（Markdown） */
  markdown: string;
  /** 主图表（取最值得可视化的一列分布） */
  chart?: {
    chartType: 'bar' | 'pie';
    title: string;
    data: QueryResult;
  };
}

// 分类字段候选关键词：命中则视为「离散维度」字段，适合做分布统计
// 按优先级排序：靠前的字段信息量更大，更适合做主图表
const CATEGORY_KEYWORDS = [
  '案由',
  '地区',
  '省份',
  '城市',
  '罪名',
  '判决结果',
  '结果',
  '法院',
  '案件类型',
  '类型',
  '原告类型',
  '被告类型',
  '主体',
  '性质',
  '审理程序',
  '年份',
  '月份',
];

// 数值字段候选关键词：命中则视为「度量」字段，适合做 sum/avg
const NUMERIC_KEYWORDS = ['金额', '赔偿', '天数', '数量', '总数', '数', '额', '费'];

/**
 * 判断某列是否为分类（离散）字段，返回其在关键词表中的优先级（越小越优先）
 */
function categoricalPriority(colName: string): number {
  const idx = CATEGORY_KEYWORDS.findIndex((k) => colName.includes(k));
  return idx; // -1 表示非分类字段
}

/**
 * 判断某列是否为数值字段
 */
function isNumeric(colName: string): boolean {
  return NUMERIC_KEYWORDS.some((k) => colName.includes(k));
}

/**
 * 生成上传后的数据概览
 */
export async function generateOverview(): Promise<OverviewResult> {
  const meta = await describeTable('data');

  // 分类字段按关键词优先级排序（案由 > 地区 > 判决结果 > ...）
  const categoricalCols = meta.columns
    .map((c) => ({ col: c, priority: categoricalPriority(c.name) }))
    .filter((x) => x.priority >= 0)
    .sort((a, b) => a.priority - b.priority)
    .map((x) => x.col);
  const numericCols = meta.columns.filter((c) => isNumeric(c.name));

  const lines: string[] = [];
  lines.push(`已导入 **${meta.name}** 表，共 **${meta.rowCount}** 行、**${meta.columns.length}** 个字段。`);

  // 1. 数值字段的统计
  if (numericCols.length > 0) {
    const col = numericCols[0];
    try {
      const r = await runQuery(
        `SELECT COUNT(*) AS cnt, ROUND(AVG("${col.name}"), 2) AS avg, MIN("${col.name}") AS min, MAX("${col.name}") AS max FROM data WHERE "${col.name}" IS NOT NULL`
      );
      const row = r.rows[0];
      lines.push(
        `- 核心数值字段 **${col.name}**：均值 ${row.avg ?? '-'}，区间 ${row.min ?? '-'} ~ ${row.max ?? '-'}`
      );
    } catch {
      // 忽略统计失败
    }
  }

  // 2. 分类字段的分布（取第一个分类字段做分布）
  let chart: OverviewResult['chart'];
  if (categoricalCols.length > 0) {
    const col = categoricalCols[0];
    try {
      const r = await runQuery(
        `SELECT "${col.name}" AS category, COUNT(*) AS cnt FROM data WHERE "${col.name}" IS NOT NULL AND "${col.name}" != '' GROUP BY "${col.name}" ORDER BY cnt DESC LIMIT 12`
      );
      lines.push(`- 主要维度 **${col.name}** 分布（Top ${r.rows.length}）：`);
      r.rows.forEach((row, i) => {
        lines.push(`  ${i + 1}. ${row.category}：${row.cnt} 件`);
      });

      chart = {
        chartType: 'pie',
        title: `${col.name}分布`,
        data: {
          columns: [
            { name: 'category', type: 'VARCHAR' },
            { name: 'cnt', type: 'BIGINT' },
          ],
          rows: r.rows.map((row) => ({ category: row.category, cnt: row.cnt })),
          rowCount: r.rows.length,
        },
      };
    } catch {
      // 忽略
    }
  }

  // 3. 字段清单
  lines.push('');
  lines.push(`可用字段：${meta.columns.map((c) => `\`${c.name}\``).join('、')}。`);
  lines.push('');
  lines.push('你可以从左侧选择分析模板，或用自然语言继续提问。');

  return { meta, markdown: lines.join('\n'), chart };
}
