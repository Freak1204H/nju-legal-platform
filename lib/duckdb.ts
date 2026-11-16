// DuckDB-WASM 数据层：在浏览器端完成 CSV 导入、Schema 提取与 SQL 执行
// 无需后端数据库，数据完全留在用户本地，兼顾隐私与性能（对应「端云协同」技术亮点）

import * as duckdb from '@duckdb/duckdb-wasm';

export interface ColumnMeta {
  name: string;
  type: string;
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
  rowCount: number;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let worker: Worker | null = null;
let initialized = false;

/**
 * 初始化 DuckDB 实例（幂等，全局单例）
 * 使用本地 public/duckdb 下的 wasm 与 worker，避免 CDN 跨域问题
 */
export async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (initialized && db && conn) return db;

  // 手动构造 bundle，指向本地静态资源
  const bundle: duckdb.DuckDBBundle = {
    mainModule: new URL('/duckdb/duckdb-eh.wasm', window.location.origin).href,
    mainWorker: new URL('/duckdb/duckdb-browser-eh.worker.js', window.location.origin).href,
    pthreadWorker: null,
  };

  worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  conn = await db.connect();
  initialized = true;
  return db;
}

export function getConnection(): duckdb.AsyncDuckDBConnection {
  if (!conn) throw new Error('DuckDB 尚未初始化，请先调用 getDB()');
  return conn;
}

/**
 * 将用户上传的 CSV 文件导入为 DuckDB 表
 * @param file 用户上传的 CSV 文件
 * @param tableName 目标表名（默认 data）
 */
export async function importCSV(
  file: File,
  tableName: string = 'data'
): Promise<TableMeta> {
  const d = await getDB();
  const c = getConnection();

  const csvText = await file.text();

  // 将 CSV 文本注册为虚拟文件，再导入为表（自动推断字段类型）
  await d.registerFileText('temp.csv', csvText);
  await c.query(`DROP TABLE IF EXISTS ${tableName}`);
  await c.insertCSVFromPath('temp.csv', {
    name: tableName,
    detect: true,
    header: true,
  });

  return describeTable(tableName);
}

/**
 * 读取某张表的 schema 与行数
 */
export async function describeTable(tableName: string = 'data'): Promise<TableMeta> {
  const c = getConnection();

  const describeResult = await c.query(`DESCRIBE ${tableName}`);
  const columns: ColumnMeta[] = describeResult
    .toArray()
    .map((r) => ({
      name: String((r as any).column_name),
      type: String((r as any).column_type),
    }));

  const countResult = await c.query(`SELECT COUNT(*) AS cnt FROM ${tableName}`);
  const rowCount = Number((countResult.toArray()[0] as any).cnt);

  return { name: tableName, columns, rowCount };
}

/**
 * 执行一条 SQL 查询并返回结构化结果
 */
export async function runQuery(sql: string): Promise<QueryResult> {
  const c = getConnection();

  const result = await c.query(sql);
  const columns: ColumnMeta[] = result.schema.fields.map((f) => ({
    name: f.name,
    type: String(f.type),
  }));

  const rows = result.toArray().map((r) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const v = (r as any)[col.name];
      // DuckDB-WASM 返回 BigInt 时转 Number，避免 JSON 序列化报错
      obj[col.name] = typeof v === 'bigint' ? Number(v) : v;
    }
    return obj;
  });

  return { columns, rows, rowCount: rows.length };
}

/**
 * 读取前 N 行预览（用于让 LLM 了解数据形态）
 */
export async function previewRows(limit: number = 5): Promise<QueryResult> {
  return runQuery(`SELECT * FROM data LIMIT ${limit}`);
}
