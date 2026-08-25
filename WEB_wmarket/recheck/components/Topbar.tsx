'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Search, Star, LogOut, UserRound, Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useSidePanel } from '@/lib/side-panel-context';
import { serverIdentityKey, PriceItem, serverPath } from '@/lib/api';
import { marketCategoryOfItem } from '@/lib/marketCategory';
import { formatCoinValue } from '@/lib/format';
import { EASE } from './motion';
import { ItemIcon } from './ItemIcon';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { ServerSwitcher } from './ServerSwitcher';

const MAX_RESULTS = 8;

/** Small shared pop-in for header dropdowns: scale+rise from their anchor. */
function Dropdown({ children, className, role }: { children: React.ReactNode; className?: string; role?: string }) {
  return (
    <m.div
      role={role}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.18, ease: EASE }}
      className={className}
    >
      {children}
    </m.div>
  );
}

export function Topbar({
  query,
  onQueryChange,
  items,
  server,
}: {
  query?: string;
  onQueryChange?: (value: string) => void;
  /** When provided, typing shows an instant results dropdown (real matches
   * from this list, nothing fabricated). Omit on pages with no item data
   * (e.g. /login, /watchlist) — search just won't offer a dropdown there. */
  items?: PriceItem[];
  /** Current server name, shown as a small badge next to the logo. */
  server?: string;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidePanel = useSidePanel();

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchValue = query ?? localQuery;
  const trimmedQuery = searchValue.trim().toLowerCase();
  const results = useMemo(() => {
    if (!items || !trimmedQuery) return [];
    return items
      .filter((item) => item.name.toLowerCase().includes(trimmedQuery) || item.id.toLowerCase().includes(trimmedQuery))
      .slice(0, MAX_RESULTS);
  }, [items, trimmedQuery]);

  const showDropdown = searchFocused && trimmedQuery.length > 0 && !!items;

  function selectResult(item: PriceItem) {
    setSearchFocused(false);
    if (sidePanel) sidePanel.open(item.id);
    else if (server) router.push(serverPath(server, `/item/${encodeURIComponent(item.id)}`));
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070a13]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1315px] items-center gap-2.5 px-3 sm:px-5">
        <BrandLogo server={server} />

        {/* v19: dedicated switcher — visible on every screen size */}
        <div className="ml-1">
          <ServerSwitcher current={server} />
        </div>

        <div className="relative ml-auto w-full max-w-[430px]" ref={searchRef}>
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={searchInputRef}
            value={searchValue}
            onChange={(e) => {
              const value = e.target.value;
              if (onQueryChange) onQueryChange(value);
              else setLocalQuery(value);
            }}
            onFocus={() => setSearchFocused(true)}
            placeholder="ค้นหาไอเทม เช่น Diamond, Oak Planks..."
            className="h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-16 text-[13px] font-semibold text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-cyan-400/10"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-black text-slate-500 sm:block">Ctrl K</span>

          <AnimatePresence>
          {showDropdown && (
            <Dropdown className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl border border-white/10 bg-[#0c101c] shadow-[0_20px_50px_rgba(0,0,0,.5)]">
              {results.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">ไม่พบสินค้าที่ตรงกับ &quot;{searchValue}&quot;</p>
              ) : (
                results.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectResult(item)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-white/[0.06]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                      <ItemIcon id={item.id} name={item.name} size={28} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-slate-100">{item.name}</span>
                      <span className="block text-[10px] font-semibold text-slate-500">{marketCategoryOfItem(item)}</span>
                    </span>
                    <span className="shrink-0 price-number text-[13px] font-bold text-emerald-400">{formatCoinValue(item.sell)}</span>
                  </button>
                ))
              )}
            </Dropdown>
          )}
          </AnimatePresence>
        </div>

        <div className="ml-1 flex items-center gap-1">
          {server && <Link href={serverPath(server, '/alerts')} className="relative rounded-xl p-2.5 text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100" aria-label="แจ้งเตือน">
            <Bell size={19} />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-[#070a13]" />
          </Link>}
          {server && <Link href={serverPath(server, '/watchlist')} className="rounded-xl p-2.5 text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100" aria-label="รายการโปรด">
            <Star size={19} />
          </Link>}
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-300 ring-1 ring-white/10 transition hover:ring-cyan-400/40"
                aria-label="เมนูโปรไฟล์"
                aria-expanded={menuOpen}
              >
                <UserRound size={18} />
              </button>
              <AnimatePresence>
          {menuOpen && (
                <Dropdown className="absolute right-0 top-[calc(100%+8px)] z-40 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0c101c] py-1 shadow-[0_10px_30px_rgba(0,0,0,.5)]">
                  {user.email && (
                    <div className="truncate border-b border-white/10 px-3.5 py-2 text-xs font-semibold text-slate-500">{user.email}</div>
                  )}
                  <Link href={server ? serverPath(server, '/watchlist') : '/'} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.06]">
                    <Star size={15} /> รายการโปรด
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); logout(); }}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-semibold text-red-400 hover:bg-red-500/10"
                  >
                    <LogOut size={15} /> ออกจากระบบ
                  </button>
                </Dropdown>
              )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              <ThemeToggle />
              <Link href="/login" className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-slate-400 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-100" aria-label="เข้าสู่ระบบ">
                <UserRound size={19} />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
