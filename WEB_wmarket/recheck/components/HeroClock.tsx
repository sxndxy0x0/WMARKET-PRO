'use client';

import { useEffect, useState } from 'react';

function greetingFor(hour: number): string {
  if (hour < 5) return 'ดึกแล้วนะ';
  if (hour < 12) return 'สวัสดีตอนเช้า';
  if (hour < 15) return 'สวัสดีตอนบ่าย';
  if (hour < 19) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

/**
 * Live Thai clock band for the dashboard hero: time-of-day greeting,
 * a ticking clock, and the full Thai date. Pure client-side — it reads
 * nothing from any API.
 */
export function HeroClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // First paint lands on the next frame (keeps effects free of sync
    // setState), then the clock ticks every second.
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, []);

  const hour = now?.getHours() ?? 0;
  const greeting = greetingFor(hour);
  const isDay = hour >= 6 && hour < 18;

  return (
    <div className="anim-fade-up mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0D1520] px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg" aria-hidden="true">
          {isDay ? '☀️' : '🌙'}
        </span>
        <div>
          <p className="text-sm font-extrabold text-slate-100">{greeting} 👋</p>
          <p className="text-xs text-slate-500">ยินดีต้อนรับสู่ WMarket — ราคาอัปเดตจาก Mod โดยตรง</p>
        </div>
      </div>
      <div className="text-right">
        <p className="price-number text-xl font-extrabold leading-none text-cyan-300 tabular-nums" suppressHydrationWarning>
          {now
            ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--:--:--'}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-500" suppressHydrationWarning>
          {now
            ? now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
            : ''}
        </p>
      </div>
    </div>
  );
}
