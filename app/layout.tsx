import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '律析 · AI 法律数据分析平台',
  description:
    '基于大模型的智能法律数据分析与可视化平台 —— 自然语言驱动，让数据说话',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        {children}
      </body>
    </html>
  );
}
