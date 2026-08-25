'use client';

import { useMemo, useState } from 'react';
import { PriceItem } from '@/lib/api';
import { CATEGORIES, ItemCategory, groupItemsByCategory } from '@/lib/categories';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';
import { useSidePanel } from '@/lib/side-panel-context';
import { MinecraftIcon } from './MinecraftIcon';
import { WatchStar } from './WatchStar';
import { Topbar } from './Topbar';
import { ItemSidePanel } from './ItemSidePanel';

// Rank within a category by value — sell price when the server reports
// one, otherwise buy, so items that are buy-only (e.g. some shop items)
// still get ranked instead of dropping to the bottom.
function rankValue(item: PriceItem): number {
  if (item.sell >= 0) return item.sell;
  if (item.buy >= 0) return item.buy;
  return -1;
}

export function CategoriesClient({ server, items }: { server: string; items: PriceItem[] }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ItemCategory | 'all'>('all');
  const sidePanel = useSidePanel();

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  }, [items, query]);

  const grouped = useMemo(() => {
    const groups = groupItemsByCategory(filtered);
    for (const [, list] of groups) {
      list.sort((a, b) => rankValue(b) - rankValue(a));
    }
    return groups;
  }, [filtered]);

  const visibleCategories = active === 'all' ? CATEGORIES : CATEGORIES.filter((c) => c.id === active);

  return (
    <>
      <Topbar query={query} onQueryChange={setQuery} items={items} server={server} />

      <main className="flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="font-sans text-2xl font-semibold text-slate-100">หมวดหมู่สินค้า</h1>
          <p className="mt-1 font-sans text-sm text-slate-500">
            สินค้าบนเซิร์ฟเวอร์ {server} จัดกลุ่มตามหมวดหมู่ เรียงจากมูลค่าสูงสุด
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActive('all')}
            className={`rounded-lg border px-3 py-1.5 font-sans text-sm font-medium ${
              active === 'all'
                ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                : 'border-white/10 text-slate-400 hover:bg-white/[0.04]'
            }`}
          >
            ทั้งหมด
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-sans text-sm font-medium ${
                active === c.id
                  ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                  : 'border-white/10 text-slate-400 hover:bg-white/[0.04]'
              }`}
            >
              <MinecraftIcon id={c.icon} size={16} />
              {c.label}
              <span className="font-sans text-xs text-slate-500">{grouped.get(c.id)?.length ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-8">
          {visibleCategories.map((cat) => {
            const catItems = grouped.get(cat.id) ?? [];
            return (
              <section key={cat.id} className="rounded-xl border border-white/10 bg-[#0b0f1c] p-5 shadow-[0_10px_30px_rgba(0,0,0,.3)]">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04]">
                    <MinecraftIcon id={cat.icon} size={24} />
                  </span>
                  <div>
                    <h2 className="font-sans text-base font-semibold text-slate-100">{cat.label}</h2>
                    <p className="font-sans text-xs text-slate-500">{cat.description}</p>
                  </div>
                  <span className="ml-auto font-sans text-xs text-slate-500">
                    {catItems.length} รายการ
                  </span>
                </div>

                {catItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/15 py-10 text-center">
                    <p className="font-sans text-sm text-slate-500">
                      {items.length === 0 ? 'ยังไม่มีข้อมูลราคา' : 'ไม่พบสินค้าที่ตรงกับการค้นหา'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 text-left font-sans text-xs uppercase tracking-wider text-slate-500">
                          <th className="py-2 pr-4 font-medium">อันดับ</th>
                          <th className="py-2 pr-4 font-medium">สินค้า</th>
                          <th className="py-2 pr-4 font-medium text-right">ราคาขาย</th>
                          <th className="py-2 pr-4 font-medium text-right">ราคาซื้อ</th>
                          <th className="py-2 pl-4 font-medium text-right">อัปเดตล่าสุด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catItems.map((item, i) => (
                          <tr
                            key={item.id}
                            className="border-b border-white/10 last:border-0 hover:bg-white/[0.03]"
                          >
                            <td className="py-3 pr-4 font-sans text-xs text-slate-500">
                              {i < 3 ? (
                                <span
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-sans text-[11px] font-semibold text-[#050810] ${
                                    i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : 'bg-orange-500'
                                  }`}
                                >
                                  {i + 1}
                                </span>
                              ) : (
                                i + 1
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <WatchStar server={server} itemId={item.id} />
                                <MinecraftIcon id={item.id} size={20} />
                                <button
                                  type="button"
                                  onClick={() => sidePanel?.open(item.id)}
                                  className="font-sans text-sm font-medium text-slate-100 hover:text-cyan-300"
                                >
                                  {item.name}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-right price-number text-sm font-medium text-emerald-400">
                              {formatCoinValue(item.sell)}
                            </td>
                            <td className="py-3 pr-4 text-right price-number text-sm text-slate-300">
                              {formatCoinValue(item.buy)}
                            </td>
                            <td className="py-3 pl-4 text-right font-sans text-xs text-slate-500">
                              {formatRelativeTime(item.updated_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      <ItemSidePanel server={server} items={items} />
    </>
  );
}
