'use client';

import Link from 'next/link';
import { m } from 'framer-motion';
import { Bell, Flame, ChevronLeft, ChevronRight } from 'lucide-react';
import { GainerItem, HistoryPoint, serverPath } from '@/lib/api';
import { marketCategoryOf } from '@/lib/marketCategory';
import { formatCoinValue } from '@/lib/format';
import { EASE } from './motion';
import { ItemIcon } from './ItemIcon';
import { WatchStar } from './WatchStar';
import { LazySparkline } from './LazySparkline';

export function TrendingStrip({ leaders, histories, server }: { leaders: GainerItem[]; histories: Record<string, HistoryPoint[]>; server: string }) {
  if (!leaders.length) return null;
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-100"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-orange-400/15 text-orange-400"><Flame size={15} /></span>กำลังมาแรง</div>
          <p className="mt-0.5 text-xs text-slate-500">5 รายการที่ราคาขยับเด่นล่าสุด</p>
        </div>
        {server && <Link href={serverPath(server, '/alerts')} className="hidden items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-bold text-slate-400 hover:border-white/20 hover:text-slate-100 sm:inline-flex"><Bell size={13} /> แจ้งเตือนราคา</Link>}
      </div>
      <div className="relative group">
        <button type="button" aria-label="เลื่อนซ้าย" onClick={() => document.getElementById('trending-scroll')?.scrollBy({ left: -320, behavior: 'smooth' })} className="absolute left-0 top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-[#0c101c]/95 p-2 text-slate-200 shadow-lg backdrop-blur sm:flex"><ChevronLeft size={18} /></button>
        <div id="trending-scroll" className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-0 pb-1">
          {leaders.map((item, index) => {
            const up = item.changePct >= 0;
            return (
              <m.div
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: index * 0.07, ease: EASE }}
                className={`card-lift group/card relative min-w-[286px] snap-start rounded-2xl border border-white/10 bg-[#0c101c] shadow-[0_4px_18px_rgba(0,0,0,.3)] sm:min-w-[300px]`}
              >
                <span className="absolute left-3 top-3 z-10 shrink-0">
                  <WatchStar server={server} itemId={item.id} />
                </span>
                <Link prefetch={false} href={serverPath(server, `/item/${encodeURIComponent(item.id)}`)} className="block p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 pl-7">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] transition-transform duration-200 group-hover/card:scale-[1.06]"><ItemIcon id={item.id} name={item.name} size={30} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-extrabold text-slate-100">{item.name}</span>
                        <span className="block text-[10px] font-bold text-cyan-300">{marketCategoryOf(item.id, item.name)}</span>
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${up ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>{up ? '▲' : '▼'} {Math.abs(item.changePct).toFixed(1)}%</span>
                  </div>
                  <div className="mt-2.5 flex items-end justify-between gap-2"><div><div className="price-number text-base font-extrabold text-emerald-400">{formatCoinValue(item.currentSell)}</div><div className="mt-1 text-[11px] text-slate-500">จาก {formatCoinValue(item.pastSell)}</div></div><span className={up ? 'text-emerald-400' : 'text-red-400'}><LazySparkline itemId={item.id} server={server} /></span></div>
                </Link>
              </m.div>
            );
          })}
        </div>
        <button type="button" aria-label="เลื่อนขวา" onClick={() => document.getElementById('trending-scroll')?.scrollBy({ left: 320, behavior: 'smooth' })} className="absolute right-0 top-1/2 z-20 hidden translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-[#0c101c]/95 p-2 text-slate-200 shadow-lg backdrop-blur sm:flex"><ChevronRight size={18} /></button>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-[#060810] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-[#060810] to-transparent" />
      </div>
    </section>
  );
}
