'use client';

import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HistoryPoint } from '@/lib/api';
import { formatCoins } from '@/lib/format';

/** Compact axis labels — 1.2k / 3.4M — keeps the Y axis readable at h-72. */
function compactCoins(value: number): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

type TooltipEntry = { value?: number | string };
type TooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
};

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const raw = Number(payload[0]?.value);
  if (!Number.isFinite(raw)) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0c101c]/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-black tabular-nums text-cyan-300">฿{formatCoins(raw)}</p>
    </div>
  );
}

export function HistoryChart({ points, heightClass = 'h-72' }: { points: HistoryPoint[]; heightClass?: string }) {
  // Axis labels are timezone-formatted (toLocaleString), so render only after
  // hydration — server TZ and visitor TZ may legitimately differ.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const validPoints = points.filter((p) => Number.isFinite(p.sell) && p.sell >= 0 && Number.isFinite(p.created_at) && p.created_at > 0);
  if (!mounted || validPoints.length < 2)
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-xl border border-dashed border-white/15`}>
        <p className="text-sm text-slate-500">ยังไม่มีข้อมูลย้อนหลังมากพอ — กลับมาเช็คอีกครั้งหลังราคาซิงก์เพิ่ม</p>
      </div>
    );

  const sorted = validPoints.slice().sort((a, b) => a.created_at - b.created_at);
  const data = sorted.map((p) => ({
    time: new Date(p.created_at * 1000).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    sell: p.sell,
  }));

  const sells = data.map((d) => d.sell);
  const max = Math.max(...sells);
  const min = Math.min(...sells);
  const spread = max - min;
  // Only draw the min/max guides when they are meaningfully apart, otherwise
  // a flat-price item gets two overlapping lines that just read as noise.
  const showGuides = spread > 0;
  const trendUp = sells[sells.length - 1] >= sells[0];
  const lineColor = trendUp ? '#34d399' : '#f87171';

  const lastLabel = data[data.length - 1].time;

  return (
    <div className={`${heightClass} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis
            stroke="#64748b"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v) => compactCoins(Number(v))}
            domain={[Math.max(0, min - spread * 0.08), max + spread * 0.08]}
            allowDataOverflow={false}
          />
          {showGuides && (
            <>
              <ReferenceLine
                y={max}
                stroke="rgba(52,211,153,0.35)"
                strokeDasharray="4 4"
                label={{ value: `สูงสุด ฿${formatCoins(max)}`, position: 'insideTopRight', fill: '#34d399', fontSize: 10 }}
              />
              <ReferenceLine
                y={min}
                stroke="rgba(248,113,113,0.3)"
                strokeDasharray="4 4"
                label={{ value: `ต่ำสุด ฿${formatCoins(min)}`, position: 'insideBottomRight', fill: '#f87171', fontSize: 10 }}
              />
            </>
          )}
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="sell"
            stroke={lineColor}
            strokeWidth={2.25}
            fill="url(#historyFill)"
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx, cy, index } = props;
              if (index !== data.length - 1 || cx == null || cy == null) return null;
              return (
                <g key={`latest-${lastLabel}`}>
                  <circle cx={cx} cy={cy} r={6.5} fill={lineColor} opacity={0.25} />
                  <circle cx={cx} cy={cy} r={3} fill={lineColor} stroke="#0b0f1c" strokeWidth={1.5} />
                </g>
              );
            }}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: '#0b0f1c', fill: lineColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
