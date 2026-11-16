/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 纯静态导出：整个应用无服务端依赖，可部署到任意静态托管（或本地直接打开）
  output: 'export',
  // 允许 Next.js 打包 DuckDB-WASM 与 ECharts 等大型依赖
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/duckdb-wasm'],
  },
};

module.exports = nextConfig;
