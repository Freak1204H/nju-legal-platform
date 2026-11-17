# 律析 · AI 法律数据分析平台

> 基于大模型与智能体（Agent）的智能法律数据分析与可视化 Web 应用
> 让非技术用户用自然语言完成复杂的数据查询、统计与可视化

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![DeepSeek](https://img.shields.io/badge/LLM-DeepSeek-orange)](https://platform.deepseek.com/)

## 项目简介

「律析」是一个 **AI Native** 的法律数据分析平台。用户只需上传法律领域的数据文件（如裁判文书统计、案件记录等 CSV），即可通过**自然语言对话**完成数据查询、统计分析、趋势洞察与图表可视化，无需掌握 SQL 或任何编程技能。

系统核心亮点在于**端到端的 AI Agent 工作流**：大模型自主规划 → 生成 SQL → 调用工具执行 → 依据真实结果作答，而非简单的 API 套壳。

## 核心功能

- 📊 **自然语言查询**：用中文提问，AI 自动生成并执行 SQL（如「统计各类案件的判决数量」）
- 📈 **智能可视化**：AI 根据数据形态自动选择柱状图/折线图/饼图等并渲染（ECharts）
- 🤖 **AI Agent 工作流**：基于 Function Calling 的自主规划、工具调用、多轮决策
- 🔒 **端侧数据引擎**：基于 DuckDB-WASM 在浏览器本地执行查询，数据不出本地，保护隐私
- ⚡ **流式响应**：SSE 打字机效果，AI 思考过程与工具调用过程可视化
- 🏛️ **垂直领域优化**：针对法律场景的专业提示词与解读
- 🧩 **分析模板**：将「按案由/年份/地区/金额档拆胜诉率」等内行拆法固化为按钮，降低提问门槛
- 📋 **上传后概览**：上传数据自动生成数据画像（行数字段、数值统计、分类分布图）
- 💬 **回答后联想**：AI 回答后给出「你还可以这样问」追问建议，形成分析闭环
- 📱 **响应式适配**：桌面侧栏 + 移动端底部抽屉，手机也能完整使用

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器 (客户端)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  React UI   │  │  Agent 循环   │  │ DuckDB-WASM│  │
│  │  (Next.js)  │→ │ (Function    │→ │ (端侧 SQL  │  │
│  │             │  │  Calling)    │  │  查询引擎) │  │
│  └─────────────┘  └──────┬───────┘  └────────────┘  │
│                          │ SSE 流式                  │
└──────────────────────────┼──────────────────────────┘
                           │ 前端直连（浏览器 → DeepSeek）
                           ▼
                    DeepSeek API（云端）
```

> 本项目为**纯静态部署**：数据查询在浏览器端通过 DuckDB-WASM 完成，大模型调用由前端直接请求 DeepSeek，无服务端代理。

### 关键技术选型

| 技术 | 用途 | 选型理由 |
|------|------|----------|
| Next.js 14 (App Router) | 前端框架 | 纯静态导出，可部署到任意静态托管，大陆访问稳定 |
| TypeScript | 类型安全 | 提升代码质量与可维护性（评分点：前端工程质量） |
| DeepSeek | 大语言模型 | 中文能力强、成本低、支持 Function Calling（OpenAI 兼容） |
| DuckDB-WASM | 端侧数据引擎 | 浏览器内执行 SQL，数据不出本地，体现「端云协同」 |
| ECharts | 可视化 | 成熟、图表类型丰富、定制性强 |
| Tailwind CSS | 样式 | 快速构建统一设计系统 |

### Agent 工作流设计

```
用户提问
   │
   ▼
[系统提示词 + 数据 Schema 注入] → 让 AI 理解可用字段
   │
   ▼
[LLM 决策] ── 需要数据？──► [调用 query_data 工具] ──► DuckDB 执行 SQL
   │                            │
   │                            ▼
   │                        [工具结果回填]
   │                            │
   │ 需要图表？──► [调用 generate_chart 工具] ──► ECharts 渲染
   │                            │
   ▼                            ▼
[基于真实数据生成最终回答] ◄──── 循环迭代（最多 3 轮）
```

## 快速开始

### 环境要求

- Node.js ≥ 18
- 一个 DeepSeek API Key（[免费注册](https://platform.deepseek.com/)）

### 安装运行

```bash
# 1. 克隆仓库
git clone <你的仓库地址>
cd legal-data-ai

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入你的 NEXT_PUBLIC_DEEPSEEK_API_KEY

# 4. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 即可使用。

### 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `NEXT_PUBLIC_DEEPSEEK_API_KEY` | DeepSeek API 密钥 | `sk-xxxxxxxx` |
| `NEXT_PUBLIC_DEEPSEEK_BASE_URL` | API 地址（可选，有默认值） | `https://api.deepseek.com` |
| `NEXT_PUBLIC_DEEPSEEK_MODEL` | 模型名（可选，有默认值） | `deepseek-chat` |

> ⚠️ 本项目为纯静态部署，`NEXT_PUBLIC_` 前缀的变量会在构建时内联进前端代码，任何访问网页的人都能看到。赛后请到 platform.deepseek.com 重置密钥。

## 使用指南

1. 点击「数据上传」上传 CSV 文件，或点击示例数据按钮
2. 等待 AI 自动识别字段（顶部状态变为「数据已就绪」）
3. 在输入框用自然语言提问，例如：
   - 「统计各类案件的判决数量」
   - 「近五年案件数量趋势如何？」
   - 「原告胜诉率最高的是哪类案件？」
4. 观察右侧 AI 的工具调用过程与流式回答、自动生成的图表

## 数据格式说明

上传的 CSV 文件第一行应为表头，支持中文字段名。系统会自动推断字段类型（数值、文本、日期等）。

## 部署

线上地址：**https://nju-legal-platform-qct8.vercel.app**

推荐部署到 [Vercel](https://vercel.com/)：

1. 将代码推送到 GitHub
2. 在 Vercel 导入该仓库
3. 在 **Settings → Environment Variables** 配置 `NEXT_PUBLIC_DEEPSEEK_API_KEY`
4. 部署完成后，在 **Deployments** 页面对最新构建执行一次 **Redeploy**（`NEXT_PUBLIC_` 变量在构建时内联，改完必须重新构建才生效）

## 项目结构

```
legal-data-ai/
├── app/
│   ├── layout.tsx          # 全局布局
│   ├── page.tsx            # 主页面（对话界面）
│   └── globals.css         # 全局样式
├── components/
│   ├── DataUpload.tsx      # 数据上传组件
│   └── ChartRenderer.tsx   # 图表渲染组件
├── lib/
│   ├── duckdb.ts           # DuckDB-WASM 数据层
│   ├── agent.ts            # Agent 循环逻辑（前端直连 DeepSeek）
│   ├── templates.ts        # 分析模板数据
│   └── overview.ts         # 上传后概览逻辑
├── public/
│   ├── duckdb/             # DuckDB wasm/worker 静态资源
│   └── sample-data/        # 示例数据
└── ...
```

## 团队信息

**学校**：南京大学

**团队名称**：冰冰冰冰

| 姓名 | 角色 | 分工 |
|------|------|------|
| 黄畅 | 队长 | 前端开发、Agent 设计 |
| 朱子健 | 队员 | 数据层、部署 |

## 许可证

本项目仅用于参赛展示，保留所有权利。
