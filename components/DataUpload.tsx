'use client';

import { useCallback, useRef, useState } from 'react';
import type { TableMeta } from '@/lib/duckdb';
import { importCSV, describeTable, previewRows } from '@/lib/duckdb';

interface DataUploadProps {
  onDataLoaded: (meta: TableMeta) => void;
}

// 示例数据文件（放在 public/sample-data 下）
const SAMPLE_FILES = ['lawsuits.csv', 'court_cases.csv'];

export default function DataUpload({ onDataLoaded }: DataUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError('');
      try {
        const tableMeta = await importCSV(file);
        setMeta(tableMeta);
        onDataLoaded(tableMeta);
      } catch (e: any) {
        setError(e?.message || '导入失败，请确认是有效的 CSV 文件');
      } finally {
        setLoading(false);
      }
    },
    [onDataLoaded]
  );

  const handleSample = async (name: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/sample-data/${name}`);
      const csvText = await res.text();
      // 复用 importCSV 需要 File 对象，这里直接构造
      const file = new File([csvText], name, { type: 'text/csv' });
      const tableMeta = await importCSV(file);
      setMeta(tableMeta);
      onDataLoaded(tableMeta);
    } catch (e: any) {
      setError(e?.message || '示例数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-800">数据上传</h2>
      <p className="mb-4 text-sm text-slate-500">
        上传 CSV 格式的法律数据文件，AI 将自动识别字段并支持自然语言分析
      </p>

      {/* 上传区域 */}
      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-8 transition hover:border-primary-400 hover:bg-primary-50"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <svg className="mb-2 h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm font-medium text-slate-600">
          {loading ? '正在导入解析…' : '点击上传或拖拽 CSV 文件到此处'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* 示例数据 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">没有数据？试试示例：</span>
        {SAMPLE_FILES.map((f) => (
          <button
            key={f}
            onClick={() => handleSample(f)}
            disabled={loading}
            className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-600 transition hover:bg-primary-100 disabled:opacity-50"
          >
            {f.replace('.csv', '')}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {/* 数据概览 */}
      {meta && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">
            已导入「{meta.name}」表 · {meta.rowCount} 行 · {meta.columns.length} 个字段
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {meta.columns.slice(0, 12).map((c) => (
              <span
                key={c.name}
                className="rounded bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
              >
                {c.name}
                <span className="ml-1 text-slate-400">({c.type})</span>
              </span>
            ))}
            {meta.columns.length > 12 && (
              <span className="text-xs text-slate-400">+{meta.columns.length - 12} 更多</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
