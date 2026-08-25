'use client';

/**
 * Server switcher (v19) — replaces the old nav dropdown.
 *
 * Why a rewrite: the old control was hidden below the md breakpoint and
 * navigated with <Link> inside an animated dropdown, which on some pages
 * lost the click to the exit animation / outside-click handler. This one:
 * - is visible at EVERY viewport width,
 * - closes the menu first, then routes via router.push (no animation race),
 * - shows short names (ports trimmed for display only).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Check, ChevronsUpDown, Server } from 'lucide-react';
import { fetchServers, serverIdentityKey, serverPath, shortServerLabel } from '@/lib/api';
import { EASE } from './motion';

export function ServerSwitcher({ current }: { current?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchServers()
      .then((list) => {
        if (!cancelled) setServers(list.map((entry) => entry.name));
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function switchTo(target: string) {
    if (current && serverIdentityKey(current) === serverIdentityKey(target)) {
      setOpen(false);
      return;
    }
    // Close BEFORE routing so the exit animation can never swallow the
    // navigation — then push on the next frame.
    setOpen(false);
    requestAnimationFrame(() => router.push(serverPath(target)));
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="เปลี่ยนเซิร์ฟเวอร์"
        className="inline-flex max-w-[190px] items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] font-bold text-slate-300 transition hover:border-cyan-400/30 hover:bg-white/[0.06] hover:text-cyan-200 sm:max-w-[240px]"
      >
        <Server size={14} className="shrink-0 text-emerald-400" />
        <span className="truncate">{current ? shortServerLabel(current) : 'เลือกเซิร์ฟเวอร์'}</span>
        <ChevronsUpDown size={12} className="shrink-0 text-slate-500" />
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#0c101c] py-1 shadow-lg"
          >
            {servers.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500">กำลังโหลดเซิร์ฟเวอร์…</p>
            ) : (
              servers.map((s) => {
                const active = Boolean(current && serverIdentityKey(current) === serverIdentityKey(s));
                return (
                  <button
                    key={s}
                    type="button"
                    role="menuitem"
                    onClick={() => switchTo(s)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.06] ${active ? 'text-cyan-300' : 'text-slate-300'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{shortServerLabel(s)}</span>
                      {shortServerLabel(s) !== s && (
                        <span className="block truncate text-[10px] font-medium text-slate-600">{s}</span>
                      )}
                    </span>
                    {active && <Check size={15} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
