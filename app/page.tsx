'use client';

import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DataUpload from '@/components/DataUpload';
import ChartRenderer from '@/components/ChartRenderer';
import { runAgent } from '@/lib/agent';
import type { ChatMessage } from '@/lib/agent';
import { runQuery } from '@/lib/duckdb';
import type { TableMeta, QueryResult } from '@/lib/duckdb';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chart?: {
    chartType: 'bar' | 'line' | 'pie' | 'scatter';
    title: string;
    data: QueryResult;
  };
  streaming?: boolean;
}

interface ToolTrace {
  id: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  label: string;
}

export default function Home() {
  const [tableMeta, setTableMeta] = useState<TableMeta | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolTrace, setToolTrace] = useState<ToolTrace[]>([]);

  const historyRef = useRef<ChatMessage[]>([]);
  const lastQueryResultRef = useRef<QueryResult | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  /**
   * 工具执行器：将 Agent 的工具调用映射到真实的数据操作
   */
  const toolExecutor = useCallback(async (name: string, args: any) => {
    if (name === 'query_data') {
      const sql = args.sql as string;
      const result = await runQuery(sql);
      lastQueryResultRef.current = result;
      return {
        columns: result.columns.map((c) => c.name),
        rows: result.rows.slice(0, 50), // 截断，避免 token 过多
        totalRows: result.rowCount,
      };
    }

    if (name === 'generate_chart') {
      const result = lastQueryResultRef.current;
      if (!result) {
        throw new Error('尚未查询到数据，无法生成图表');
      }
      return {
        chartType: args.chartType,
        title: args.title,
        dataSample: result.rows.slice(0, 30),
        columns: result.columns.map((c) => c.name),
      };
    }

    throw new Error(`未知工具: ${name}`);
  }, []);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setToolTrace([]);

    // 添加用户消息
    const userMsg: DisplayMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
    };
    setMessages((prev) => [...prev, userMsg]);

    // 添加一个空的 assistant 消息，用于流式填充
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);

    let finalChart: DisplayMessage['chart'];
    let accumulated = '';

    const updateAssistant = (content: string, chart?: DisplayMessage['chart']) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content, chart: chart ?? m.chart, streaming: false }
            : m
        )
      );
    };

    try {
      await runAgent(
        question,
        tableMeta,
        historyRef.current,
        toolExecutor,
        (event) => {
          switch (event.type) {
            case 'delta':
              accumulated += event.content || '';
              updateAssistant(accumulated);
              scrollToBottom();
              break;

            case 'tool_call': {
              const traceId = `t-${Date.now()}-${event.toolName}`;
              setToolTrace((prev) => [
                ...prev,
                {
                  id: traceId,
                  toolName: event.toolName || '',
                  status: 'running',
                  label: event.content || event.toolName || '',
                },
              ]);
              break;
            }

            case 'tool_result': {
              // 标记最后一条对应工具为完成
              setToolTrace((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1 && t.status === 'running'
                    ? { ...t, status: 'done' }
                    : t
                )
              );
              // 如果结果是 generate_chart，构建图表
              if (event.toolName === 'generate_chart' && event.result) {
                const r = event.result as any;
                const data = lastQueryResultRef.current;
                if (data) {
                  finalChart = {
                    chartType: r.chartType as any,
                    title: r.title,
                    data,
                  };
                  updateAssistant(accumulated, finalChart);
                }
              }
              break;
            }

            case 'done':
              updateAssistant(accumulated, finalChart);
              break;

            case 'error':
              updateAssistant(
                accumulated || `⚠️ ${event.content || '发生错误'}`
              );
              break;
          }
        }
      );

      // 更新历史记录（供后续多轮对话）
      historyRef.current.push({ role: 'user', content: question });
      historyRef.current.push({ role: 'assistant', content: accumulated });
    } catch (e: any) {
      updateAssistant(`⚠️ ${e?.message || '发生未知错误'}`);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, tableMeta, toolExecutor, scrollToBottom]);

  return (
    <div className="flex h-screen flex-col">
      {/* 顶部导航 */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">律析</h1>
              <p className="text-xs text-slate-500">AI 驱动的法律数据分析平台</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            {tableMeta ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 ring-1 ring-emerald-200">
                数据已就绪 · {tableMeta.rowCount} 行
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600 ring-1 ring-amber-200">
                等待上传数据
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 gap-6 overflow-hidden px-6 py-6">
        {/* 左侧：数据上传 + 说明 */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto lg:block">
          <DataUpload onDataLoaded={setTableMeta} />

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">可以这样问</h3>
            <ul className="space-y-2 text-xs text-slate-500">
              {[
                '「统计各类案件的判决数量」',
                '「近五年案件数量趋势如何？」',
                '「原告胜诉率最高的是哪类案件？」',
                '「各地区案件分布占比」',
                '「分析被告类型的构成」',
              ].map((q) => (
                <li
                  key={q}
                  className="cursor-pointer rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-primary-50 hover:text-primary-600"
                  onClick={() => !isStreaming && setInput(q.replace('「', '').replace('」', ''))}
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* 右侧：对话区 */}
        <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-6">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h2 className="mb-2 text-lg font-semibold text-slate-700">开始你的法律数据分析</h2>
                <p className="max-w-md text-sm text-slate-500">
                  先上传法律数据文件（或使用左侧示例），然后用自然语言提问，
                  律析会自主查询数据并生成可视化图表
                </p>
              </div>
            )}

            <div className="space-y-5">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`animate-fade-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'user' ? (
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary-600 px-4 py-3 text-sm text-white">
                      {m.content}
                    </div>
                  ) : (
                    <div className="max-w-[85%] space-y-3">
                      <div className="rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                        {m.streaming && !m.content ? (
                          <span className="text-slate-400">正在思考…</span>
                        ) : (
                          <div className="markdown-body max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {m.content}
                            </ReactMarkdown>
                            {m.streaming && <span className="typing-cursor" />}
                          </div>
                        )}
                      </div>

                      {/* 图表渲染 */}
                      {m.chart && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <ChartRenderer
                            chartType={m.chart.chartType}
                            title={m.chart.title}
                            data={m.chart.data}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* 工具调用过程可视化 */}
              {toolTrace.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-1.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-3">
                    <p className="text-xs font-medium text-slate-500">⚙️ Agent 工具调用</p>
                    {toolTrace.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            t.status === 'running'
                              ? 'animate-pulse bg-amber-400'
                              : t.status === 'done'
                              ? 'bg-emerald-400'
                              : 'bg-red-400'
                          }`}
                        />
                        <span className="font-mono text-slate-600">{t.toolName}</span>
                        <span className="text-slate-400">{t.label}</span>
                        {t.status === 'done' && (
                          <span className="text-emerald-500">✓</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div ref={chatEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t border-slate-200 p-4">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder={
                  tableMeta
                    ? '用自然语言提问，例如：统计各类案件的判决数量'
                    : '请先上传数据文件开始分析'
                }
                disabled={isStreaming}
                className="max-h-40 flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50"
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isStreaming ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6l6 6-6 6" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              律析可能产生不准确的分析结果，请结合实际情况判断 · Enter 发送，Shift+Enter 换行
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
