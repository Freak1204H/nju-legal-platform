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
import { ANALYSIS_TEMPLATES, TEMPLATE_GROUPS } from '@/lib/templates';
import { generateOverview } from '@/lib/overview';

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
  /** 回答后的「你还可以这样问」追问建议 */
  followUps?: string[];
}

interface ToolTrace {
  id: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  label: string;
}

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
   * 生成「你还可以这样问」追问建议：从模板池选 3 个，排除与当前问题重复的
   */
  const buildFollowUps = useCallback((currentQuestion: string): string[] => {
    const candidates = ANALYSIS_TEMPLATES.map((t) => t.question);
    const filtered = candidates.filter((q) => q !== currentQuestion);
    // 无重复依赖的简单轮换：按当前问题在数组中的位置偏移取 3 个
    const startIdx = candidates.indexOf(currentQuestion);
    const picks: string[] = [];
    for (let i = 0; i < filtered.length && picks.length < 3; i++) {
      const idx = (startIdx + i + 1) % candidates.length;
      const q = candidates[idx];
      if (q !== currentQuestion && !picks.includes(q)) picks.push(q);
    }
    return picks;
  }, []);

  /**
   * 数据加载回调：设置表元数据 + 自动生成概览
   */
  const handleDataLoaded = useCallback(
    async (meta: TableMeta) => {
      setTableMeta(meta);
      setMessages([]);
      setToolTrace([]);

      // 生成概览
      try {
        const overview = await generateOverview();
        setMessages((prev) => [
          ...prev,
          {
            id: `overview-${Date.now()}`,
            role: 'assistant',
            content: overview.markdown,
            chart: overview.chart,
          },
        ]);
        scrollToBottom();
      } catch {
        // 概览失败不阻塞使用
      }
    },
    [scrollToBottom]
  );

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

    const updateAssistant = (
      content: string,
      chart?: DisplayMessage['chart'],
      followUps?: string[]
    ) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content,
                chart: chart ?? m.chart,
                followUps: followUps ?? m.followUps,
                streaming: false,
              }
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
              updateAssistant(accumulated, finalChart, buildFollowUps(question));
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
  }, [input, isStreaming, tableMeta, toolExecutor, scrollToBottom, buildFollowUps]);

  return (
    <div className="page-bg flex h-screen flex-col">
      {/* 顶部导航 */}
      <header className="border-b border-slate-200/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md shadow-blue-500/20">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900">
                律析
              </h1>
              <p className="text-xs text-slate-500">AI 驱动的法律数据分析平台</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tableMeta ? (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 ring-1 ring-emerald-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                数据已就绪 · {tableMeta.rowCount} 行
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-600 ring-1 ring-amber-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                等待上传数据
              </span>
            )}

            {/* 手机端：打开数据上传抽屉 */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-500 lg:hidden"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              数据
            </button>
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 gap-6 overflow-hidden px-6 py-5">
        {/* 左侧：数据上传 + 说明 */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto pr-1 lg:block">
          <DataUpload onDataLoaded={handleDataLoaded} />

          <div className="card-shadow mt-4 rounded-2xl border border-slate-200/70 bg-white p-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">分析模板</h3>
            <p className="mb-3 text-xs text-slate-400">点击下方维度快速分析</p>
            <div className="space-y-3">
              {TEMPLATE_GROUPS.map((group) => (
                <div key={group.category}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {group.category}
                  </p>
                  <div className="space-y-1.5">
                    {group.items.map((t) => (
                      <button
                        key={t.label}
                        onClick={() => !isStreaming && setInput(t.question)}
                        className="group flex w-full items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-blue-200 hover:bg-blue-50/60"
                      >
                        <svg className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
                        </svg>
                        <span className="group-hover:text-blue-600">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* 右侧：对话区 */}
        <section className="card-shadow flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-6">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="brand-gradient-soft mb-5 flex h-20 w-20 items-center justify-center rounded-3xl text-blue-500">
                  <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h2 className="mb-2 text-xl font-semibold tracking-tight text-slate-800">
                  开始你的<span className="text-gradient">法律数据分析</span>
                </h2>
                <p className="max-w-md text-sm leading-relaxed text-slate-500">
                  先上传法律数据文件（或使用左侧示例），然后用自然语言提问，
                  律析会自主查询数据并生成可视化图表
                </p>
              </div>
            )}

            <div className="space-y-6">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`animate-fade-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'user' ? (
                    <div className="user-bubble-shadow max-w-[80%] rounded-2xl rounded-tr-md bg-gradient-to-br from-blue-600 to-blue-500 px-4 py-3 text-sm leading-relaxed text-white">
                      {m.content}
                    </div>
                  ) : (
                    <div className="flex max-w-[88%] gap-3">
                      {/* AI 头像 */}
                      <div className="brand-gradient mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="rounded-2xl rounded-tl-md bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                          {m.streaming && !m.content ? (
                            <span className="thinking-dots">
                              <span /><span /><span />
                            </span>
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
                          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                            <ChartRenderer
                              chartType={m.chart.chartType}
                              title={m.chart.title}
                              data={m.chart.data}
                            />
                          </div>
                        )}

                        {/* 你还可以这样问 */}
                        {m.followUps && m.followUps.length > 0 && (
                          <div className="pt-1">
                            <p className="mb-1.5 text-xs font-medium text-slate-400">你还可以这样问</p>
                            <div className="flex flex-wrap gap-1.5">
                              {m.followUps.map((q) => (
                                <button
                                  key={q}
                                  onClick={() => !isStreaming && setInput(q)}
                                  className="rounded-full border border-blue-100 bg-blue-50/50 px-3 py-1 text-xs text-blue-600 transition hover:border-blue-300 hover:bg-blue-100/60"
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* 工具调用过程可视化 */}
              {toolTrace.length > 0 && (
                <div className="flex justify-start pl-10">
                  <div className="space-y-1.5 rounded-2xl border border-blue-100 bg-blue-50/40 p-3.5">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-blue-500">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Agent 工具调用
                    </p>
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
                        <span className="font-mono font-medium text-blue-700">{t.toolName}</span>
                        <span className="text-slate-400">{t.label}</span>
                        {t.status === 'done' && (
                          <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
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
          <div className="border-t border-slate-200/70 bg-slate-50/50 p-4">
            <div className="flex items-end gap-3">
              <div className="flex flex-1 items-end rounded-2xl border border-slate-200 bg-white px-1 shadow-sm transition focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
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
                  className="max-h-40 flex-1 resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400 disabled:opacity-60"
                />
                <button
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
                  className="brand-gradient m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md shadow-blue-500/25 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
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
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              律析可能产生不准确的分析结果，请结合实际情况判断 · Enter 发送，Shift+Enter 换行
            </p>
          </div>
        </section>
      </main>

      {/* 手机端：数据上传抽屉 */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* 抽屉面板（底部弹出） */}
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
            {/* 顶部把手 + 关闭按钮 */}
            <div className="mb-4 flex items-center justify-between">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 数据上传 */}
            <DataUpload onDataLoaded={handleDataLoaded} />

            {/* 分析模板 */}
            <div className="card-shadow mt-4 rounded-2xl border border-slate-200/70 bg-white p-5">
              <h3 className="mb-1 text-sm font-semibold text-slate-800">分析模板</h3>
              <p className="mb-3 text-xs text-slate-400">点击下方维度快速分析</p>
              <div className="space-y-3">
                {TEMPLATE_GROUPS.map((group) => (
                  <div key={group.category}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {group.category}
                    </p>
                    <div className="space-y-1.5">
                      {group.items.map((t) => (
                        <button
                          key={t.label}
                          onClick={() => {
                            if (isStreaming) return;
                            setInput(t.question);
                            setMobileMenuOpen(false);
                          }}
                          className="group flex w-full items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-blue-200 hover:bg-blue-50/60"
                        >
                          <svg className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
                          </svg>
                          <span className="group-hover:text-blue-600">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
