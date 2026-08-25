'use client';

import Link from 'next/link';
import { Bell, TrendingDown, TrendingUp } from 'lucide-react';
import { Topbar } from './Topbar';
import { WatchStar } from './WatchStar';
import { HistoryChart } from './HistoryChart';
import { HistoryPoint, serverPath } from '@/lib/api';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';
import { useEffect, useMemo, useState } from 'react';

type Period = '24H' | '7D' | '30D' | '90D';

export function ItemDetailClient({ id, server, history }: { id: string; server: string; history: HistoryPoint[] }) {
  const [period, setPeriod] = useState<Period>('7D');
  // Hydration-safe: 0 = "pre-mount", cutoff falls back to include everything,
  // then the effect fills the real clock after hydration.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, []);
  const orderedHistory = useMemo(() => history.slice().sort((a, b) => b.created_at - a.created_at), [history]);
  const validHistory = useMemo(() => orderedHistory.filter((p) => Number.isFinite(p.created_at) && p.created_at > 0), [orderedHistory]);
  const pricedHistory = useMemo(() => validHistory.filter((p) => Number.isFinite(p.sell) && p.sell >= 0), [validHistory]);
  const latestRecord = validHistory[0];
  const latest = pricedHistory[0];
  const displayName = latestRecord?.name ?? id.replace(/^minecraft:/, '').replace(/_/g, ' ');

  const filtered = useMemo(() => {
    const days = period === '24H' ? 1 : period === '7D' ? 7 : period === '30D' ? 30 : 90;
    const cutoff = now === 0 ? -Infinity : now / 1000 - days * 86400;
    return pricedHistory.filter((p) => p.created_at >= cutoff);
  }, [pricedHistory, period, now]);

  const availableDays = useMemo(() => {
    if (pricedHistory.length < 2) return 0;
    const oldest = pricedHistory[pricedHistory.length - 1].created_at;
    const newest = pricedHistory[0].created_at;
    return Math.max(0, (newest - oldest) / 86400);
  }, [pricedHistory]);

  const periodDays = period === '24H' ? 1 : period === '7D' ? 7 : period === '30D' ? 30 : 90;
  const hasFullPeriod = availableDays >= periodDays;
  const chartLabel = filtered.length >= 2
    ? (hasFullPeriod ? period : `ข้อมูลย้อนหลัง ${availableDays < 1 ? `${Math.max(1, Math.round(availableDays * 24))} ชั่วโมง` : `${Math.floor(availableDays)} วัน`}`)
    : 'ยังไม่มีข้อมูลเพียงพอ';

  const sellValues = filtered.map((p) => p.sell).filter((v) => Number.isFinite(v) && v >= 0);
  const min = sellValues.length ? Math.min(...sellValues) : -1;
  const max = sellValues.length ? Math.max(...sellValues) : -1;
  const first = filtered[filtered.length - 1]?.sell;
  const changePct = hasFullPeriod && first !== undefined && Number.isFinite(first) && first > 0 && latest && Number.isFinite(latest.sell) && latest.sell >= 0
    ? ((latest.sell - first) / first) * 100
    : null;

  return (
    <>
      <Topbar server={server} />
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Link prefetch={false} href={serverPath(server)} className="text-sm text-slate-500 hover:text-cyan-300">← กลับไปหน้าตลาด</Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-sans text-xs uppercase tracking-wider text-slate-500">{id}</p>
            <div className="mt-1 flex items-center gap-2">
              <WatchStar server={server} itemId={id} />
              <h1 className="truncate text-2xl font-semibold capitalize text-slate-100 sm:text-3xl">{displayName}</h1>
            </div>
          </div>
          <Link prefetch={false} href={`${serverPath(server, '/alerts')}?itemId=${encodeURIComponent(id)}&itemName=${encodeURIComponent(displayName)}`} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/10 bg-[#0b0f1c] px-3.5 py-2 text-sm font-medium text-slate-300 hover:bg-white/[0.04]">
            <Bell size={15} /> ตั้งค่าแจ้งเตือน
          </Link>
        </div>

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBlock label="ราคาขายปัจจุบัน" value={latest ? formatCoinValue(latest.sell) : '—'} highlight />
          <StatBlock label="ราคาซื้อ" value={latest ? formatCoinValue(latest.buy) : '—'} />
          <StatBlock label="ต่ำสุดในช่วง" value={min >= 0 ? formatCoinValue(min) : '—'} />
          <StatBlock label="สูงสุดในช่วง" value={max >= 0 ? formatCoinValue(max) : '—'} />
        </section>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {changePct !== null && (
              <span key={changePct.toFixed(2)} className={`anim-pop inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${changePct >= 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
                {changePct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
            {latestRecord && <span>อัปเดตล่าสุด {formatRelativeTime(latestRecord.created_at)}</span>}
          </div>
          <div className="inline-flex rounded-lg border border-white/10 bg-[#0b0f1c] p-1 shadow-[0_10px_30px_rgba(0,0,0,.3)]">
            {(['24H', '7D', '30D', '90D'] as Period[]).map((value) => (
              <button type="button" key={value} onClick={() => setPeriod(value)} aria-pressed={period === value} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${period === value ? 'bg-cyan-400/15 text-cyan-300' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'}`}>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="anim-fade-up mt-4 rounded-2xl border border-white/10 bg-[#0b0f1c] p-4 shadow-[0_10px_30px_rgba(0,0,0,.3)] sm:p-5" style={{ ['--d' as string]: '120ms' }}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">ประวัติราคาขาย</h2>
              <p className="mt-0.5 text-xs text-slate-500">ความเคลื่อนไหวช่วง {chartLabel}</p>
            </div>
          </div>
          {filtered.length >= 2 ? (
            <div key={period} className="spark-reveal">
              <HistoryChart points={filtered} />
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
              ยังไม่มีข้อมูลเพียงพอสำหรับช่วง {period}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function StatBlock({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b0f1c] p-3.5 shadow-[0_10px_30px_rgba(0,0,0,.3)] sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 price-number text-xl sm:text-2xl ${highlight ? 'text-cyan-300' : 'text-slate-100'}`}>{value}</p>
    </div>
  );
}
