'use client';

import { SearchX } from 'lucide-react';
import { PriceItem } from '@/lib/api';
import { marketCategoryOfItem } from '@/lib/marketCategory';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';
import { useSidePanel } from '@/lib/side-panel-context';
import { EmptyState } from './motion';
import { ItemIcon } from './ItemIcon';
import { LazySparkline } from './LazySparkline';

function changeFor(item: PriceItem, changeMap?: Record<string, number>) {
  const mapped = changeMap?.[item.id];
  if (typeof mapped === 'number' && Number.isFinite(mapped)) return mapped;
  const embedded = (item as PriceItem & { changePct?: unknown }).changePct;
  return typeof embedded === 'number' && Number.isFinite(embedded) ? embedded : null;
}

export function ItemsTable({
  items,
  server,
  emptyMessage = 'ยังไม่มีสินค้าที่ตรงกับตัวกรอง',
  showRank = true,
  rankStart = 1,
  changeMap,
}: {
  items: PriceItem[];
  server: string;
  emptyMessage?: string;
  showRank?: boolean;
  rankStart?: number;
  changeMap?: Record<string, number>;
}) {
  const sidePanel = useSidePanel();

  if (items.length === 0) {
    return <EmptyState icon={<SearchX size={22} />} title={emptyMessage} hint="ลองเปลี่ยนช่วงราคา หมวดหมู่ หรือคำค้นหา" />;
  }

  function openItem(id: string) {
    sidePanel?.open(id);
  }

  return (
    <>
      {/* Desktop / tablet — keep the header in normal table flow.
          The table itself sits inside a horizontal overflow container; making
          <thead> vertically sticky here causes the browser to position it
          relative to that nested scroll container, which can make the header
          appear between item rows. */}
      <div className="market-table-wrap hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-[#0b0f1c]/95 backdrop-blur">
            <tr className="border-b border-white/10 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {showRank && <th className="w-12 px-3.5 py-2.5 font-bold">#</th>}
              <th className="px-3.5 py-2.5 font-bold">ไอเทม</th>
              <th className="hidden px-3.5 py-2.5 font-bold sm:table-cell">หมวดหมู่</th>
              <th className="px-3.5 py-2.5 text-right font-bold">ราคาล่าสุด</th>
              <th className="hidden px-3.5 py-2.5 text-right font-bold md:table-cell" title="ราคาขายสูงสุดที่เคยบันทึก (ตลอดกาล) — ต่ำสุด/สูงสุดในช่วง 7 วันดูได้ในหน้ารายละเอียดไอเทม">สูงสุด (ตลอด)</th>
              <th className="px-3.5 py-2.5 text-right font-bold">เปลี่ยนแปลง (24ชม.)</th>
              <th className="hidden px-3.5 py-2.5 text-right font-bold lg:table-cell">อัปเดตล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const change = changeFor(item, changeMap);
              const positive = change !== null && change > 0;
              const negative = change !== null && change < 0;
              const rank = rankStart + i;
              return (
                <tr
                  key={item.id}
                  onClick={sidePanel ? () => openItem(item.id) : undefined}
                  onKeyDown={sidePanel ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openItem(item.id);
                    }
                  } : undefined}
                  tabIndex={sidePanel ? 0 : undefined}
                  role={sidePanel ? 'button' : undefined}
                  className={`group border-b border-white/10 transition-colors ${sidePanel ? 'cursor-pointer hover:bg-cyan-400/[0.025] hover:shadow-[inset_2px_0_0_rgba(0,229,255,.35)] focus:outline-none focus-visible:bg-cyan-400/[0.05] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-400/40' : ''}`}
                >
                  {showRank && (
                    <td className="px-3.5 py-3 align-middle">
                      <span className={`text-xs font-black ${rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-orange-400' : 'text-slate-600'}`}>
                        {rank}
                      </span>
                    </td>
                  )}
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-white/[0.03] transition-all duration-200 group-hover:scale-[1.04]">
                        <ItemIcon id={item.id} name={item.name} size={32} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-extrabold leading-5 text-slate-100 group-hover:text-cyan-300">
                          {item.name}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-3.5 py-3 align-middle sm:table-cell">
                    <span className="inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-1 text-[10px] font-extrabold tracking-wide text-cyan-300">
                      {marketCategoryOfItem(item)}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-right align-middle price-number">
                    <span className="text-[15px] font-extrabold tabular-nums text-emerald-400">
                      {formatCoinValue(item.sell)}
                    </span>
                  </td>
                  <td className="hidden px-3.5 py-3 text-right align-middle price-number md:table-cell">
                    <span className="text-[13px] font-bold tabular-nums text-slate-300">
                      {item.sellHigh >= 0 ? `${formatCoinValue(item.sellHigh)}` : '—'}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {/* Known 24h change → badge + spark together; unknown → dash only. */}
                    <div className="flex items-center justify-end gap-2">
                      {change !== null && Math.abs(change) > 0.005 ? (
                        <>
                          <span
                            title="เปลี่ยนแปลง 24 ชั่วโมง"
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${
                              positive ? 'bg-emerald-400/10 text-emerald-400' : negative ? 'bg-red-400/10 text-red-400' : 'bg-white/5 text-slate-500'
                            }`}
                          >
                            {positive ? '▲' : negative ? '▼' : '•'} {Math.abs(change).toFixed(1)}%
                          </span>
                          <span className={positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-slate-500'}>
                            <LazySparkline itemId={item.id} server={server} />
                          </span>
                        </>
                      ) : (
                        <span className="text-[13px] font-bold text-slate-600">—</span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-3.5 py-3 text-right align-middle font-sans text-[11px] text-slate-500 lg:table-cell">
                    {formatRelativeTime(item.updated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile — compact stacked cards instead of a cramped horizontal table. */}
      <div className="sm:hidden">
        {items.map((item, i) => {
          const change = changeFor(item, changeMap);
          const positive = change !== null && change > 0;
          const negative = change !== null && change < 0;
          const rank = rankStart + i;
          const rowClassName = 'group flex min-h-[76px] w-full items-center gap-2.5 border-b border-white/10 px-3.5 py-3 text-left transition-colors';
          const rowContent = (
            <>
              <div className="flex w-[22px] shrink-0 flex-col items-center gap-1">
                {showRank && (
                  <span className={`text-[10px] font-black ${rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-orange-400' : 'text-slate-600'}`}>#{rank}</span>
                )}
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-white/[0.03]">
                <ItemIcon id={item.id} name={item.name} size={34} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-extrabold leading-5 text-slate-100">{item.name}</span>
                <span className="mt-0.5 block text-[10px] font-semibold tracking-wide text-slate-500">{marketCategoryOfItem(item)}</span>
              </span>
              <span className="shrink-0 text-right price-number">
                <span className="block text-[14px] font-extrabold tabular-nums text-emerald-400">{formatCoinValue(item.sell)}</span>
                <span className={`mt-0.5 block text-[10px] font-bold tabular-nums ${positive || negative ? 'text-slate-400' : 'text-slate-600'}`}>
                  {change === null ? '—' : `${positive ? '▲' : negative ? '▼' : '•'} ${Math.abs(change).toFixed(1)}%`}
                </span>
              </span>
            </>
          );
          if (!sidePanel) {
            return (
              <div key={item.id} className={`${rowClassName} hover:bg-white/[0.04]`}>
                {rowContent}
              </div>
            );
          }

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`เปิดรายละเอียด ${item.name}`}
              onClick={() => openItem(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openItem(item.id);
                }
              }}
              className={`cursor-pointer ${rowClassName} hover:bg-white/[0.04]`}
            >
              {rowContent}
            </div>
          );
        })}
      </div>
    </>
  );
}
