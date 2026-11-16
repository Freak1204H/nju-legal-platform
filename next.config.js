/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 允许 Next.js 打包 DuckDB-WASM 与 ECharts 等大型依赖
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/duckdb-wasm'],
  },
};

module.exports = nextConfig;
