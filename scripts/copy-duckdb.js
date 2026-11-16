// postinstall：将 DuckDB 的 wasm 与 worker 文件复制到 public 目录
// 避免在 Git 仓库中提交大体积二进制文件，安装后自动生成
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = path.join(__dirname, 'public', 'duckdb');

const files = [
  'duckdb-eh.wasm',
  'duckdb-mvp.wasm',
  'duckdb-browser-eh.worker.js',
  'duckdb-browser-mvp.worker.js',
];

if (!fs.existsSync(src)) {
  console.warn('[copy-duckdb] 未找到 duckdb-wasm 包，请先执行 npm install');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

for (const file of files) {
  const from = path.join(src, file);
  const to = path.join(dest, file);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
    console.log(`[copy-duckdb] ${file} 已复制`);
  }
}

console.log('[copy-duckdb] DuckDB 静态资源准备完成');
