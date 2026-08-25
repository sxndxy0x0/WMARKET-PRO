'use client';

import { useMemo, useState } from 'react';
import { PriceItem } from '@/lib/api';
import { marketCategoryOfItem, MarketCategory } from '@/lib/marketCategory';
import { Topbar } from './Topbar';
import { ItemsTable } from './ItemsTable';
import { ItemSidePanel } from './ItemSidePanel';
import { useWatchlistContext } from '@/lib/watchlist-context';

const FILTERS = ['ทั้งหมด', '⭐ รายการโปรด', 'BLOCK', 'POTIONS', 'ENCHANT', 'FISHING', 'NATURAL', 'GEAR', 'MOB', 'ORES', 'CROPS'] as const;
type Filter = (typeof FILTERS)[number];

function categoryOf(item: PriceItem): MarketCategory {
  return marketCategoryOfItem(item);
}

export function ItemsPageClient({ server, items }: { server: string; items: PriceItem[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ทั้งหมด');
  const { isWatched } = useWatchlistContext();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = items.filter((item) => {
      const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
      const matchesFilter = filter === 'ทั้งหมด'
        ? true
        : filter === '⭐ รายการโปรด'
          ? isWatched(server, item.id)
          : categoryOf(item) === filter;
      return matchesQuery && matchesFilter;
    });
    return result;
  }, [items, query, filter, isWatched, server]);

  return (
    <div className="min-h-screen">
      <Topbar query={query} onQueryChange={setQuery} items={items} server={server} />
      <main className="mx-auto max-w-[1315px] px-3 pb-12 pt-4 sm:px-5 lg:px-0">
        <div className="mb-5 overflow-x-auto pb-1 [scrollbar-width:none]">
          <div className="flex min-w-max gap-2">
            {FILTERS.map((name) => {
              const active = filter === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setFilter(name)}
                  className={`rounded-full border px-4 py-2 text-[14px] font-semibold tracking-wide transition ${
                    active
                      ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,.25)]'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <section className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0b0f1c] shadow-[0_10px_40px_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-slate-500 sm:px-5">
            <span className="font-semibold text-slate-300">ราคาตลาด</span>
            <span>{filtered.length.toLocaleString()} / {items.length.toLocaleString()} รายการ</span>
          </div>
          <ItemsTable items={filtered} server={server} />
        </section>
      </main>

      <ItemSidePanel server={server} items={items} />
    </div>
  );
}
