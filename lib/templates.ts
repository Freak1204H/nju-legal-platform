// 分析模板：将「内行才会拆」的分析维度固化成按钮，替用户把题出好
// 按维度分组，点击后填入结构化问题，由 LLM 结合真实字段适配执行

export interface AnalysisTemplate {
  category: string; // 维度分组
  label: string; // 按钮显示
  question: string; // 点击填入输入框的问题
}

export const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
  {
    category: '整体概览',
    label: '案件总量与案由分布',
    question: '统计各类案件的判决数量，并按案由分类汇总',
  },
  {
    category: '整体概览',
    label: '判决结果构成',
    question: '分析判决结果的构成，各类结果的占比分别是多少',
  },
  {
    category: '案由分析',
    label: '各案由胜诉率对比',
    question: '按案由统计原告胜诉率，对比不同案由的胜诉情况',
  },
  {
    category: '时间趋势',
    label: '近五年案件趋势',
    question: '按年份统计案件数量，分析近五年的变化趋势',
  },
  {
    category: '地区分布',
    label: '各地区案件占比',
    question: '统计各地区的案件分布，计算占比并排序',
  },
  {
    category: '主体分析',
    label: '原告类型构成',
    question: '分析原告类型的构成分布',
  },
  {
    category: '主体分析',
    label: '被告类型构成',
    question: '分析被告类型的构成分布',
  },
  {
    category: '金额分析',
    label: '赔偿金额区间分布',
    question: '按赔偿金额区间统计案件数量分布',
  },
];

// 按 category 分组，供渲染
export const TEMPLATE_GROUPS: { category: string; items: AnalysisTemplate[] }[] =
  ANALYSIS_TEMPLATES.reduce((groups, t) => {
    const g = groups.find((g) => g.category === t.category);
    if (g) g.items.push(t);
    else groups.push({ category: t.category, items: [t] });
    return groups;
  }, [] as { category: string; items: AnalysisTemplate[] }[]);
