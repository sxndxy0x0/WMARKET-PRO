'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { X, TrendingDown, TrendingUp } from 'lucide-react';
import { useSidePanel } from '@/lib/side-panel-context';
import { fetchHistory, HistoryPoint, PriceItem } from '@/lib/api';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';
import { marketCategoryOfItem } from '@/lib/marketCategory';
import { EASE, Skeleton } from './motion';
import { ItemIcon } from './ItemIcon';
import { WatchStar } from './WatchStar';
import { HistoryChart } from './HistoryChart';

export function ItemSidePanel({ server, items, changeMap }: { server: string; items: PriceItem[]; changeMap?: Record<string, number> }) {
  const panel = useSidePanel();
  const openItemId = panel?.openItemId ?? null;
  const [historyState, setHistoryState] = useState<{
    itemId: string | null;
    points: HistoryPoint[] | null;
    error: string | null;
  }>({ itemId: null, points: null, error: null });
  // Hydration-safe clock: SSR and the client agree on "no time yet", then the
  // effect fills the real timestamp after mount.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, []);
  const history = historyState.itemId === openItemId ? historyState.points : null;
  const historyError = historyState.itemId === openItemId ? historyState.error : null;

  const item = openItemId ? items.find((i) => i.id === openItemId) ?? null : null;

  const openItemUpdatedAt = item?.updated_at ?? 0;

  useEffect(() => {
    if (!openItemId) return;
    let cancelled = false;

    const load = async (attempt: number): Promise<void> => {
      try {
        const points = await fetchHistory(server, openItemId, 500);
        if (!cancelled) setHistoryState({ itemId: openItemId, points, error: null });
      } catch (err) {
        if (cancelled) return;
        // Transient throttles (429/503) happen when many panels/tables load
        // at once — one quiet retry usually fixes it without alarming the
        // user with a raw English error string.
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (!cancelled) return load(1);
        }
        setHistoryState({ itemId: openItemId, points: null, error: err instanceof Error ? err.message : 'โหลดประวัติราคาไม่สำเร็จ' });
      }
    };

    void load(0);

    return () => {
      cancelled = true;
    };
  }, [server, openItemId, openItemUpdatedAt]);

  // Close on ESC, per spec.
  useEffect(() => {
    if (!openItemId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') panel?.close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openItemId, panel]);

  // Lock background scrolling while the panel is open so the page behind
  // doesn't drift under the user's finger/wheel.
  useEffect(() => {
    if (!openItemId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [openItemId]);

  // NOTE: no early-return here — <AnimatePresence> must stay mounted so the
  // panel can animate OUT before unmounting.
  const isOpen = Boolean(panel && openItemId);

  // Normalize API ordering before doing any time-based calculations. The
  // backend may return history newest-first or oldest-first; UI calculations
  // must not depend on that implementation detail.
  const orderedHistory = (history ?? []).slice().sort((a, b) => b.created_at - a.created_at);
  const validHistory = orderedHistory.filter((p) => Number.isFinite(p.created_at) && p.created_at > 0 && Number.isFinite(p.sell) && p.sell >= 0);
  const cutoff = now === 0 ? -Infinity : now / 1000 - 7 * 86400;
  const last7d = validHistory.filter((p) => p.created_at >= cutoff);
  const historySpanSeconds = last7d.length >= 2 ? Math.max(...last7d.map((p) => p.created_at)) - Math.min(...last7d.map((p) => p.created_at)) : 0;
  const historySpanDays = historySpanSeconds / 86400;
  const chartLabel = historySpanDays >= 6.5 ? 'กราฟราคา 7 วัน' : historySpanDays >= 1 ? `กราฟราคาย้อนหลัง ${Math.max(1, Math.floor(historySpanDays))} วัน` : 'กราฟราคาย้อนหลัง';
  const sellValues = last7d.map((p) => p.sell);
  const high7d = sellValues.length ? Math.max(...sellValues) : null;
  const low7d = sellValues.length ? Math.min(...sellValues) : null;
  const latest = validHistory[0];
  const target24h = (latest?.created_at ?? 0) - 24 * 3600;
  const dayAgo = latest ? validHistory.find((p) => p.created_at <= target24h) : undefined;
  const actualHistorySpanHours = latest && dayAgo ? (latest.created_at - dayAgo.created_at) / 3600 : 0;
  const historyChangePct = latest && dayAgo && dayAgo.sell > 0 && actualHistorySpanHours >= 23 ? ((latest.sell - dayAgo.sell) / dayAgo.sell) * 100 : null;
  const mappedChange = openItemId ? changeMap?.[openItemId] : undefined;
  const hasMapped24h = typeof mappedChange === 'number' && Number.isFinite(mappedChange);
  const changeWindowLabel = hasMapped24h || actualHistorySpanHours >= 23 ? '24H' : null;
  const changePct = hasMapped24h ? mappedChange : historyChangePct;

  return (
    <AnimatePresence>
      {isOpen ? (<>
      {/* Backdrop — fades; tap to dismiss */}
      <m.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px]"
        onClick={() => panel?.close()}
        aria-hidden="true"
      />

      {/* Panel — springs in from the right; the same damping the rest of
          the site uses so overlays feel like one physical system. */}
      <m.aside
        key="panel"
        role="dialog"
        aria-modal="true"
        aria-label={item?.name ?? openItemId ?? 'รายละเอียดไอเทม'}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 38 }}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-white/10 bg-[#0D1520] shadow-[-20px_0_60px_rgba(0,0,0,.5)]"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-300">รายละเอียดไอเทม</h2>
          <button
            type="button"
            onClick={() => panel?.close()}
            aria-label="ปิด"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!item ? (
            <p className="text-sm text-slate-500">ไม่พบข้อมูลไอเทมนี้</p>
          ) : (
            <>
              <m.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
                className="flex items-center gap-3"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                  <ItemIcon id={item.id} name={item.name} size={44} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-lg font-extrabold text-slate-100">{item.name}</h1>
                    <WatchStar server={server} itemId={item.id} />
                  </div>
                  <span className="text-[11px] font-bold tracking-wide text-cyan-300">{marketCategoryOfItem(item)}</span>
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.12, ease: EASE }}
                className="mt-5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">ราคาปัจจุบัน</p>
                <p className="mt-1 price-number text-3xl font-extrabold text-cyan-300">{formatCoinValue(item.sell)}</p>
                {changePct !== null && (
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${changePct >= 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
                    {changePct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}% ({changeWindowLabel ?? 'ช่วงข้อมูล'})
                  </span>
                )}
              </m.div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">7D HIGH</p>
                  <p className="mt-1 price-number text-base font-bold text-slate-100">{high7d !== null ? formatCoinValue(high7d) : '—'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">7D LOW</p>
                  <p className="mt-1 price-number text-base font-bold text-slate-100">{low7d !== null ? formatCoinValue(low7d) : '—'}</p>
                </div>
              </div>

              {item.sellHigh >= 0 && (
                <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">ราคาสูงสุดที่เคยบันทึกไว้</p>
                  <p className="mt-1 price-number text-base font-bold text-cyan-300">{formatCoinValue(item.sellHigh)}</p>
                </div>
              )}

              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{chartLabel}</p>
                {historyError ? (
                  <p className="rounded-xl border border-dashed border-white/15 py-8 text-center text-sm text-slate-500">{historyError}</p>
                ) : history === null ? (
                  <Skeleton className="h-48 w-full rounded-xl" />
                ) : (
                  <HistoryChart points={last7d.length >= 2 ? last7d : validHistory} heightClass="h-48" />
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-slate-500">
                <span>อัปเดตล่าสุด</span>
                <span className="font-semibold text-slate-300">{formatRelativeTime(item.updated_at)}</span>
              </div>
            </>
          )}
        </div>
      </m.aside>
      </>) : null}
    </AnimatePresence>
  );
}
