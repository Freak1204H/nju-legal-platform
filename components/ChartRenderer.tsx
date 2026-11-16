'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface ChartRendererProps {
  chartType: 'bar' | 'line' | 'pie' | 'scatter';
  title: string;
  data: { columns: { name: string }[]; rows: Record<string, unknown>[] };
}

/**
 * 将查询结果转换为 ECharts 配置并渲染
 * 自动取第一列作为 X 轴（类别），第二列作为 Y 轴（数值）
 */
export default function ChartRenderer({ chartType, title, data }: ChartRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }
    const chart = chartRef.current;

    // 前两列：第一个是类别，第二个是数值
    const xCol = data.columns[0]?.name ?? 'category';
    const yCol = data.columns[1]?.name ?? 'value';

    const categories = data.rows.map((r) => String(r[xCol] ?? ''));
    const values = data.rows.map((r) => Number(r[yCol] ?? 0));

    const baseSeries = {
      name: yCol,
      type: chartType,
      data: values,
      itemStyle: { color: '#3366ff' },
    };

    const option: echarts.EChartsOption = {
      title: {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, color: '#334155' },
      },
      tooltip: { trigger: chartType === 'pie' ? 'item' : 'axis' },
      legend: { bottom: 0 },
      grid: { left: 50, right: 30, top: 50, bottom: 40 },
      xAxis:
        chartType === 'pie'
          ? undefined
          : { type: 'category', data: categories, axisLabel: { rotate: 30, fontSize: 10 } },
      yAxis: chartType === 'pie' ? undefined : { type: 'value' },
      series:
        chartType === 'pie'
          ? [
              {
                name: yCol,
                type: 'pie',
                radius: ['40%', '70%'],
                data: categories.map((name, i) => ({ name, value: values[i] })),
                itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
              },
            ]
          : [baseSeries],
    };

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [chartType, title, data]);

  return <div ref={containerRef} className="h-80 w-full" />;
}
