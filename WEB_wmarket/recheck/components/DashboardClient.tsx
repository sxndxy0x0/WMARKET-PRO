'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import { m } from 'framer-motion';
import { ArrowDownUp, Filter, Search, Trophy, X, Sprout, Gem, Fish, Shield, Sparkles, Box, Skull, TreePine, Settings2, Package, TrendingUp, Clock, Radio } from 'lucide-react';
import { PriceItem, StatsSummary } from '@/lib/api';
import { marketCategoryOfItem, MarketCategory } from '@/lib/marketCategory';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';
import { useLiveStatus } from '@/lib/live-status-context';
import { AnimatedNumber, EASE, Reveal } from './motion';
import { HeroClock } from './HeroClock';
import { Topbar } from './Topbar';
import { ItemsTable } from './ItemsTable';
import { ItemSidePanel } from './ItemSidePanel';
import { TrendingStrip } from './TrendingStrip';

const FILTERS = [
  'ทั้งหมด',
  'BLOCK',
  'POTIONS',
  'ENCHANT',
  'FISHING',
  'NATURAL',
  'GEAR',
  'MOB',
  'ORES',
  'CROPS',
] as const;
type Filter = (typeof FILTERS)[number];

type PriceFilter = 'all' | 'under-100' | '100-500' | '500-1000' | '1000-10000' | 'over-10000' | 'custom';
type RankMode = 'price-desc' | 'price-asc' | 'name-asc' | 'name-desc' | 'updated';

function categoryOf(item: PriceItem): MarketCategory {
  return marketCategoryOfItem(item);
}

function matchesPrice(item: PriceItem, filter: PriceFilter, min: string, max: string) {
  const price = item.sell;
  if (price < 0) return false;
  if (filter === 'all') return true;
  if (filter === 'under-100') return price < 100;
  if (filter === '100-500') return price >= 100 && price < 500;
  if (filter === '500-1000') return price >= 500 && price < 1000;
  if (filter === '1000-10000') return price >= 1000 && price < 10000;
  if (filter === 'over-10000') return price >= 10000;

  const minValue = min.trim() === '' ? 0 : Number(min);
  const maxValue = max.trim() === '' ? Number.POSITIVE_INFINITY : Number(max);
  if (!Number.isFinite(minValue) || minValue < 0) return false;
  if (max.trim() !== '' && (!Number.isFinite(maxValue) || maxValue < 0)) return false;
  return price >= minValue && price <= maxValue;
}

function sortItems(items: PriceItem[], mode: RankMode) {
  return [...items].sort((a, b) => {
    if (mode === 'name-asc') return a.name.localeCompare(b.name);
    if (mode === 'name-desc') return b.name.localeCompare(a.name);
    if (mode === 'updated') return b.updated_at - a.updated_at || b.sell - a.sell;
    const aPrice = a.sell >= 0 ? a.sell : Number.NEGATIVE_INFINITY;
    const bPrice = b.sell >= 0 ? b.sell : Number.NEGATIVE_INFINITY;
    return mode === 'price-desc'
      ? bPrice - aPrice || a.name.localeCompare(b.name)
      : aPrice - bPrice || a.name.localeCompare(b.name);
  });
}

function CategoryIcon({ name }: { name: string }) {
  const map: Record<string, ElementType> = {
    CROPS: Sprout, ORES: Gem, FISHING: Fish, GEAR: Shield, ENCHANT: Sparkles, BLOCK: Box, MOB: Skull, NATURAL: TreePine, POTIONS: Sparkles,
  };
  const Icon = map[name] ?? Box;
  return <Icon size={14} strokeWidth={2.4} />;
}

export function DashboardClient({
  server,
  initialItems,
  stats,
}: {
  server: string;
  initialItems: PriceItem[];
  stats: StatsSummary;
}) {
  const [query, setQuery] = useState('');
  // Typing stays instant: heavy filter/sort work runs on a deferred copy so
  // keystrokes never wait on the table re-render.
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<Filter>('ทั้งหมด');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [rankMode, setRankMode] = useState<RankMode>('price-desc');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50);
  const liveStatus = useLiveStatus();

  const changeMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of initialItems) {
      if (typeof item.changePct === 'number' && Number.isFinite(item.changePct)) map[item.id] = item.changePct;
    }
    // Backward-compatible fallback for the existing API, which currently
    // exposes only the top gainers in stats. It must not invent values for
    // items that are absent from the backend response.
    for (const g of stats.gainers) {
      if (map[g.id] === undefined && Number.isFinite(g.changePct)) map[g.id] = g.changePct;
    }
    return map;
  }, [initialItems, stats.gainers]);

  // Real, backend-derived summary numbers only — nothing here is invented.
  // The highest-price card uses the server-provided running high when
  // available, while last-updated uses the newest real updated_at timestamp.
  const summary = useMemo(() => {
    let highestItem: PriceItem | null = null;
    let mostRecentUpdate = 0;
    for (const item of initialItems) {
      const candidatePrice = item.sellHigh >= 0 ? item.sellHigh : item.sell;
      const currentBest = highestItem ? (highestItem.sellHigh >= 0 ? highestItem.sellHigh : highestItem.sell) : -1;
      if (candidatePrice >= 0 && candidatePrice > currentBest) highestItem = item;
      if (item.updated_at > mostRecentUpdate) mostRecentUpdate = item.updated_at;
    }
    return { highestItem, mostRecentUpdate };
  }, [initialItems]);

  const customRangeValidation = useMemo(() => {
    if (priceFilter !== 'custom') return null;
    const min = minPrice.trim() === '' ? null : Number(minPrice);
    const max = maxPrice.trim() === '' ? null : Number(maxPrice);
    if (min !== null && (!Number.isFinite(min) || min < 0)) return 'กรุณาระบุราคาต่ำสุดเป็นตัวเลขที่ถูกต้อง';
    if (max !== null && (!Number.isFinite(max) || max < 0)) return 'กรุณาระบุราคาสูงสุดเป็นตัวเลขที่ถูกต้อง';
    if (min !== null && max !== null && min > max) return 'ราคาต่ำสุดต้องไม่มากกว่าราคาสูงสุด';
    return null;
  }, [priceFilter, minPrice, maxPrice]);

  const filteredItems = useMemo(() => {
    if (customRangeValidation) return [];
    const q = deferredQuery.trim().toLowerCase();
    const result = initialItems.filter((item) => {
      const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
      const matchesCategory =
        filter === 'ทั้งหมด'
          ? true
          : categoryOf(item) === filter;
      return matchesQuery && matchesCategory && matchesPrice(item, priceFilter, minPrice, maxPrice);
    });
    return sortItems(result, rankMode);
  }, [initialItems, deferredQuery, filter, priceFilter, minPrice, maxPrice, rankMode, customRangeValidation]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const pagedItems = useMemo(
    () => filteredItems.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [filteredItems, clampedPage, pageSize]
  );

  const changeFilters = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1); // any filter/search/sort change starts back at page 1
  };
  const setFilterAndReset = changeFilters(setFilter);
  const setPriceFilterAndReset = changeFilters(setPriceFilter);
  const setRankModeAndReset = changeFilters(setRankMode);
  const setQueryAndReset = changeFilters(setQuery);

  const resetFilters = () => {
    setQuery('');
    setFilter('ทั้งหมด');
    setPriceFilter('all');
    setMinPrice('');
    setMaxPrice('');
    setRankMode('price-desc');
    setPage(1);
  };

  const liveStatusLabel =
    liveStatus === 'connected' ? 'ปกติ' : liveStatus === 'reconnecting' ? 'กำลังเชื่อมต่อใหม่' : 'กำลังเชื่อมต่อ';
  const liveStatusSubtitle = liveStatus === 'connected' ? 'เชื่อมต่อสำเร็จ' : 'โปรดรอสักครู่';

  // Typed summary-card config so the JSX stays flat and the animated-number
  // path (numeric) is distinct from plain string values.
  const summaryCards = useMemo(() => {
    const highest = summary.highestItem
      ? (summary.highestItem.sellHigh >= 0 ? summary.highestItem.sellHigh : summary.highestItem.sell)
      : null;
    return [
      {
        key: 'total',
        icon: <Package size={16} />,
        label: 'ไอเทมทั้งหมด',
        numeric: stats.totalItems,
        format: (n: number) => Math.round(n).toLocaleString(),
        subtitle: 'อัปเดตอัตโนมัติ',
      },
      {
        key: 'highest',
        icon: <TrendingUp size={16} />,
        label: 'ราคาสูงสุดที่บันทึก',
        numeric: highest,
        format: (n: number) => formatCoinValue(n),
        subtitle: summary.highestItem?.name ?? '',
      },
      {
        key: 'updated',
        icon: <Clock size={16} />,
        label: 'อัปเดตล่าสุด',
        value: summary.mostRecentUpdate ? formatRelativeTime(summary.mostRecentUpdate) : '—',
        subtitle: 'ข้อมูลล่าสุดจากตลาด',
      },
      {
        key: 'api',
        icon: <Radio size={16} />,
        label: 'API Status',
        value: liveStatusLabel,
        subtitle: liveStatusSubtitle,
        dotClassName: liveStatus === 'connected' ? 'bg-emerald-400' : 'bg-amber-400',
      },
    ] as {
      key: string;
      icon: React.ReactNode;
      label: string;
      numeric?: number | null;
      format?: (n: number) => string;
      value?: string;
      subtitle: string;
      dotClassName?: string;
    }[];
  }, [stats.totalItems, summary.highestItem, summary.mostRecentUpdate, liveStatus, liveStatusLabel, liveStatusSubtitle]);

  return (
    <div className="min-h-screen [--topbar-height:68px] [--category-height:53px]">
      <Topbar query={query} onQueryChange={setQueryAndReset} items={initialItems} server={server} />

      <div className="sticky top-[var(--topbar-height)] z-20 border-b border-white/10 bg-[#070a13]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1315px] gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:px-5 lg:px-0">
          {FILTERS.map((name) => {
            const active = filter === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setFilterAndReset(name)}
                aria-pressed={active}
                className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3.5 py-3.5 text-[13px] font-bold tracking-[.01em] transition-colors ${
                  active ? 'text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <CategoryIcon name={name} />
                {name}
                {active && (
                  // Shared-layout pill: the underline glides between tabs
                  // instead of teleporting, which makes the filter bar feel
                  // physically connected to the selection.
                  <m.span
                    layoutId="category-active-pill"
                    transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,.6)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1315px] px-3 pb-14 pt-5 sm:px-5 lg:px-0">
        <HeroClock />

        {/* Market summary — every number here is real (see `summary` memo
            and `liveStatus`), nothing here is fabricated. Cards rise in a
            gentle stagger so the page feels alive on arrival. */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map((card, index) => (
            <m.div
              key={card.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05 + index * 0.07, ease: EASE }}
            >
              <SummaryCard
                icon={card.icon}
                label={card.label}
                value={card.value}
                numeric={card.numeric ?? undefined}
                numberFormat={card.format}
                subtitle={card.subtitle}
                dotClassName={card.dotClassName}
              />
            </m.div>
          ))}
        </div>

        <Reveal delay={0.15}>
          <TrendingStrip leaders={stats.gainers} histories={{}} server={server} />
        </Reveal>

        <section className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0D1520] shadow-[0_18px_50px_rgba(0,0,0,.28)]">
          <div className="border-b border-white/10 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                    <Trophy size={16} />
                  </span>
                  <div>
                    <h1 className="text-[18px] font-extrabold tracking-tight text-slate-100">ราคาตลาด</h1>
                    <p className="text-xs font-medium text-slate-500">ติดตามราคาตลาดและแนวโน้มของไอเทม · {server}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-slate-300 shadow-sm focus-within:border-cyan-400/50 focus-within:ring-4 focus-within:ring-cyan-400/10">
                  <ArrowDownUp size={15} className="text-slate-500" />
                  <span className="hidden sm:inline">จัดอันดับ</span>
                  <select
                    value={rankMode}
                    onChange={(e) => setRankModeAndReset(e.target.value as RankMode)}
                    className="bg-transparent text-sm font-bold text-slate-100 outline-none [&>option]:bg-[#0b0f1c]"
                  >
                    <option value="price-desc">ราคาสูงสุด</option>
                    <option value="price-asc">ราคาต่ำสุด</option>
                    <option value="updated">อัปเดตล่าสุด</option>
                    <option value="name-asc">ชื่อ A-Z</option>
                    <option value="name-desc">ชื่อ Z-A</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm font-bold text-slate-300 shadow-sm transition hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-100"
                >
                  <X size={15} />
                  <span className="hidden sm:inline">ล้าง</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex shrink-0 items-center gap-2 text-sm font-extrabold text-slate-200">
                <Settings2 size={16} className="text-cyan-300" />
                กรองราคา
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                {([
                  ['all', 'ทุกช่วง'],
                  ['under-100', 'ต่ำกว่า ฿100'],
                  ['100-500', '฿100–500'],
                  ['500-1000', '฿500–1K'],
                  ['1000-10000', '฿1K–10K'],
                  ['over-10000', 'มากกว่า ฿10K'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriceFilterAndReset(value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      priceFilter === value
                        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                        : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPriceFilterAndReset('custom')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    priceFilter === 'custom'
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  Custom Range
                </button>
              </div>
            </div>

            {priceFilter === 'custom' && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-3">
                <div className="relative">
                  <input
                    inputMode="decimal"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="ราคาต่ำสุด"
                    className="h-9 w-36 rounded-lg border border-white/10 bg-[#0a0e18] px-3 pr-8 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-4 focus:ring-cyan-400/10"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">฿</span>
                </div>
                <span className="text-slate-500">ถึง</span>
                <div className="relative">
                  <input
                    inputMode="decimal"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="ราคาสูงสุด"
                    className="h-9 w-36 rounded-lg border border-white/10 bg-[#0a0e18] px-3 pr-8 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50 focus:ring-4 focus:ring-cyan-400/10"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">฿</span>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Filter size={14} />
                พบ <strong className="text-slate-200">{filteredItems.length.toLocaleString()}</strong> จาก {initialItems.length.toLocaleString()} รายการ
              </span>
              {query && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1 text-amber-300">
                  <Search size={13} /> ค้นหา: “{query}”
                </span>
              )}
            </div>
            {customRangeValidation && (
              <p className="mt-2 text-xs font-semibold text-red-400" role="alert">⚠ {customRangeValidation}</p>
            )}
          </div>

          <ItemsTable
            items={pagedItems}
            server={server}
            showRank
            rankStart={(clampedPage - 1) * pageSize + 1}
            changeMap={changeMap}
          />

          {/* Pagination — client-side, since fetchPrices() returns the
              full item list in one call and the backend has no
              page/limit params to page through server-side. */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:px-5">
            <span className="text-xs text-slate-500">
              แสดง {filteredItems.length === 0 ? 0 : (clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, filteredItems.length)} จาก {filteredItems.length.toLocaleString()} รายการ
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={clampedPage <= 1}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300 disabled:opacity-30 enabled:hover:border-white/20 enabled:hover:bg-white/[0.06]"
                >
                  ‹
                </button>
                {paginationItems(clampedPage, pageCount).map((p, idx) =>
                  p === '...' ? (
                    <span key={`dots-${idx}`} className="px-1 text-xs text-slate-600">…</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`min-w-[28px] rounded-lg border px-2 py-1.5 text-xs font-bold ${
                        p === clampedPage
                          ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300'
                          : 'border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/[0.06]'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={clampedPage >= pageCount}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300 disabled:opacity-30 enabled:hover:border-white/20 enabled:hover:bg-white/[0.06]"
                >
                  ›
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                รายการต่อหน้า
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as 25 | 50 | 100);
                    setPage(1);
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-xs font-bold text-slate-200 outline-none [&>option]:bg-[#0b0f1c]"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      </main>

      <ItemSidePanel server={server} items={initialItems} changeMap={changeMap} />
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  numeric,
  numberFormat,
  subtitle,
  dotClassName,
}: {
  icon: React.ReactNode;
  label: string;
  /** Plain string value (relative times, statuses). */
  value?: string;
  /** When provided the card counts between values like a market ticker. */
  numeric?: number;
  numberFormat?: (n: number) => string;
  subtitle: string;
  dotClassName?: string;
}) {
  return (
    <div className="card-lift h-full rounded-2xl border border-white/10 bg-[#0D1520] p-3.5 sm:p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-lg font-extrabold text-slate-100 sm:text-xl">
        {dotClassName && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotClassName}`} />}
        {numeric !== undefined && Number.isFinite(numeric) ? (
          <AnimatedNumber value={numeric} format={numberFormat} />
        ) : value !== undefined ? (
          value
        ) : (
          '—'
        )}
      </p>
      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{subtitle}</p>
    </div>
  );
}

/** Compact page list: 1 … p-1 p p+1 … last, collapsing runs with "…". */
function paginationItems(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = new Set([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(items).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '...')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('...');
    out.push(sorted[i]);
  }
  return out;
}
