// 前端 Agent 循环：实现「规划 → 工具调用 → 结果整合 → 生成回答」的自主决策流程
// 这是作品 AI 技术深度的核心 —— 不把 LLM 当简单问答，而是让它主动调用工具完成数据分析

import type { TableMeta } from './duckdb';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentEvent {
  type:
    | 'thinking'   // Agent 思考过程
    | 'tool_call'  // 即将调用某个工具
    | 'tool_result'// 工具执行结果
    | 'delta'      // 回答内容流式片段
    | 'done'       // 回答结束
    | 'error';
  content?: string;
  toolName?: string;
  result?: unknown;
}

type EventHandler = (event: AgentEvent) => void;

const SYSTEM_PROMPT = `你是一位专业的法律数据分析助手，名字叫「律析」。

你的能力：
1. 你能够通过工具 query_data 对用户上传的法律数据进行 SQL 查询与统计分析
2. 你能够通过工具 generate_chart 将数据可视化

工作规则：
1. 用户提问后，先判断是否需要查询数据。若需要，调用 query_data 工具获取真实数据，再基于数据回答。
2. 涉及统计、趋势、对比、占比时，调用 generate_chart 工具生成图表。
3. 回答要专业、准确，基于真实查询结果，不要编造数据。
4. 若数据中不存在所需字段，如实告知用户可用的字段。
5. 用简洁、清晰的 Markdown 组织回答（可用表格、列表）。
6. 结合法律领域背景给出专业解读。`;

/**
 * 构建发送给 LLM 的消息列表
 */
function buildMessages(
  userQuestion: string,
  tableMeta: TableMeta | null,
  history: ChatMessage[]
): ChatMessage[] {
  const schemaDesc = tableMeta
    ? `当前已导入数据表「${tableMeta.name}」，共 ${tableMeta.rowCount} 行，字段如下：\n` +
      tableMeta.columns.map((c) => `- ${c.name} (${c.type})`).join('\n')
    : '当前尚未导入任何数据。请提示用户先上传 CSV 数据文件。';

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `【数据上下文】\n${schemaDesc}` },
    ...history,
    { role: 'user', content: userQuestion },
  ];
  return messages;
}

/**
 * 解析流式 SSE 响应中的工具调用与内容片段
 */
async function* parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}

/**
 * 主 Agent 循环
 * @param userQuestion 用户问题
 * @param tableMeta 当前数据表元信息
 * @param history 对话历史
 * @param toolExecutor 工具执行器（由外部注入，解耦数据层）
 * @param onEvent 事件回调
 */
export async function runAgent(
  userQuestion: string,
  tableMeta: TableMeta | null,
  history: ChatMessage[],
  toolExecutor: (name: string, args: any) => Promise<unknown>,
  onEvent: EventHandler
): Promise<void> {
  const messages = buildMessages(userQuestion, tableMeta, history);

  // 最多迭代 3 轮工具调用，避免死循环
  const MAX_ITERATIONS = 3;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    onEvent({ type: 'thinking', content: iteration === 0 ? '正在分析您的问题…' : '正在基于工具结果整理答案…' });

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      onEvent({ type: 'error', content: err.error || '调用大模型失败，请检查 API Key 配置' });
      return;
    }

    if (!response.body) {
      onEvent({ type: 'error', content: '响应流为空' });
      return;
    }

    // 累积本轮返回的内容与工具调用
    let contentChunks = '';
    const toolCallsMap = new Map<string, ToolCall>();

    const reader = response.body.getReader();
    for await (const chunk of parseSSE(reader)) {
      if (chunk.content) {
        contentChunks += chunk.content;
        onEvent({ type: 'delta', content: chunk.content });
      }
      if (chunk.tool_calls) {
        for (const tc of chunk.tool_calls) {
          const idx = tc.index ?? 0;
          const existing = toolCallsMap.get(String(idx)) || {
            id: tc.id || '',
            name: '',
            arguments: '',
          };
          if (tc.name) existing.name = tc.name;
          if (tc.arguments) existing.arguments += tc.arguments;
          toolCallsMap.set(String(idx), existing);
        }
      }
    }

    // 若有工具调用，执行工具并把结果回填，进入下一轮
    if (toolCallsMap.size > 0) {
      const toolCalls = Array.from(toolCallsMap.values());

      // 先推送 assistant 消息（含工具调用）
      // 注意：回填给 LLM 时必须转换为 OpenAI 标准格式（含 type 与 function 嵌套）
      messages.push({
        role: 'assistant',
        content: contentChunks || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      } as any);

      for (const tc of toolCalls) {
        onEvent({ type: 'tool_call', toolName: tc.name, content: `正在执行 ${tc.name}…` });

        let args: any = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          args = {};
        }

        try {
          const result = await toolExecutor(tc.name, args);
          onEvent({ type: 'tool_result', toolName: tc.name, result });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        } catch (e: any) {
          const errMsg = { error: e?.message || '工具执行失败' };
          onEvent({ type: 'tool_result', toolName: tc.name, result: errMsg });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(errMsg),
          });
        }
      }

      // 继续下一轮迭代，让 LLM 基于工具结果生成最终回答
      continue;
    }

    // 无工具调用，正常回答结束
    onEvent({ type: 'done' });
    return;
  }

  // 超过最大迭代次数
  onEvent({ type: 'done' });
}
