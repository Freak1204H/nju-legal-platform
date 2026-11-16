// DeepSeek LLM 代理路由
// 作用：将 API 密钥保留在服务端，前端只发送对话内容，避免密钥暴露
// DeepSeek 提供 OpenAI 兼容接口，使用 OpenAI SDK 调用

import OpenAI from 'openai';

export const runtime = 'edge';

// 工具定义（Function Calling）—— 供 Agent 自主调用
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_data',
      description:
        '对已导入的数据表执行 SQL 查询。当用户希望统计、筛选、聚合或分析数据时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: '要执行的 SQL 查询语句（DuckDB 方言）',
          },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_chart',
      description:
        '根据数据查询结果，生成适合可视化的图表配置。当用户想看趋势、对比、占比等图表时调用。',
      parameters: {
        type: 'object',
        properties: {
          chartType: {
            type: 'string',
            enum: ['bar', 'line', 'pie', 'scatter'],
            description: '图表类型',
          },
          title: { type: 'string', description: '图表标题' },
        },
        required: ['chartType', 'title'],
      },
    },
  },
] as const;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: '服务端未配置 DEEPSEEK_API_KEY' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages } = await req.json();

    const client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });

    // 流式返回，实现打字机效果
    const stream = await client.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages,
      tools: TOOLS as any,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.3,
    });

    // 将 OpenAI 流式响应透传给前端
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // 组装 SSE 格式
          const payload: Record<string, unknown> = {};

          if (delta.content) payload.content = delta.content;

          // 传递工具调用（Function Calling）信息
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            payload.tool_calls = delta.tool_calls.map((tc: any) => ({
              id: tc.id,
              index: tc.index,
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            }));
          }

          if (Object.keys(payload).length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('LLM 代理错误:', err);
    return new Response(
      JSON.stringify({ error: err?.message || '调用大模型失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
