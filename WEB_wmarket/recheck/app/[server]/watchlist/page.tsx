'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Star, Trash2 } from 'lucide-react';
import { RequireAuth } from '@/components/RequireAuth';
import { Topbar } from '@/components/Topbar';
import { serverIdentityKey, serverItemIdentityKey, fetchServers, serverPath, decodeServerSegment, WatchlistItem } from '@/lib/api';
import { useWatchlistContext } from '@/lib/watchlist-context';
import { formatCoinValue, formatRelativeTime } from '@/lib/format';


function WatchlistBody() {
  const params = useParams<{ server: string }>();
  const requestedParam = decodeServerSegment(params.server || '');
  const [serverName, setServerName] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const SERVER = serverName ?? '';

  // Reset resolution state when the route param changes — done during render
  // (the React-endorsed "adjust state on prop change" pattern) instead of
  // synchronously inside the effect below.
  const [prevParam, setPrevParam] = useState(requestedParam);
  if (prevParam !== requestedParam) {
    setPrevParam(requestedParam);
    setServerName(null);
    setServerStatus('loading');
  }

  useEffect(() => {
    let active = true;
    fetchServers().then((servers) => {
      if (!active) return;
      const canonical = servers.find((entry) => serverIdentityKey(entry.name) === serverIdentityKey(requestedParam))?.name;
      if (canonical) {
        setServerName(canonical);
        setServerStatus('ready');
      } else {
        setServerStatus('invalid');
      }
    }).catch(() => {
      if (active) {
        setServerName(null);
        setServerStatus('error');
      }
    });
    return () => { active = false; };
  }, [requestedParam]);

  // Reads the same fetch WatchlistProvider already did once at the root —
  // no second fetchWatchlist() call just for landing on this page.
  const { items, loading, remove, refresh, loadError } = useWatchlistContext();
  const serverItems = SERVER ? items.filter((item) => serverIdentityKey(item.server) === serverIdentityKey(SERVER)) : [];
  const [error, setError] = useState<string | null>(null);

  async function handleRemove(item: WatchlistItem) {
    try {
      await remove(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove item');
    }
  }

  return (
    <>
      <Topbar server={SERVER} />
      <main className="flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 font-sans text-2xl font-semibold text-slate-100">
            <Star size={22} className="text-cyan-300" fill="#22D3EE" />
            รายการโปรด
          </h1>
          <p className="mt-1 font-sans text-sm text-slate-500">
            สินค้าที่คุณติดตามอยู่บนเซิร์ฟเวอร์ {SERVER}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 font-sans text-sm text-slate-100">
            {error}
          </div>
        )}

        {serverStatus === 'loading' ? (
          <p className="font-sans text-sm text-slate-500">กำลังตรวจสอบเซิร์ฟเวอร์…</p>
        ) : serverStatus === 'error' ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center">
            <p className="font-sans text-sm font-medium text-slate-100">ตรวจสอบเซิร์ฟเวอร์ไม่สำเร็จ</p>
            <p className="mt-1 font-sans text-sm text-slate-500">ไม่สามารถโหลดรายการเซิร์ฟเวอร์จาก Backend ได้</p>
            <Link href="/" className="mt-4 inline-block rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">
              กลับไปเลือกเซิร์ฟเวอร์
            </Link>
          </div>
        ) : serverStatus === 'invalid' ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center">
            <p className="font-sans text-sm font-medium text-slate-100">ไม่พบเซิร์ฟเวอร์นี้ใน Backend</p>
            <p className="mt-1 font-sans text-sm text-slate-500">เซิร์ฟเวอร์อาจถูกถอดออกหรือชื่อใน URL ไม่ตรงกับรายการปัจจุบัน</p>
            <Link href="/" className="mt-4 inline-block rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">
              กลับไปเลือกเซิร์ฟเวอร์
            </Link>
          </div>
        ) : loadError && serverItems.length === 0 ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-6 text-center" role="alert">
            <p className="font-sans text-sm font-medium text-slate-100">โหลดรายการโปรดไม่สำเร็จ</p>
            <p className="mt-1 font-sans text-sm text-slate-500">{loadError}</p>
            <button type="button" onClick={refresh} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300">ลองอีกครั้ง</button>
          </div>
        ) : loading && serverItems.length === 0 ? (
          <p className="font-sans text-sm text-slate-500">กำลังโหลด…</p>
        ) : serverItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-16 text-center">
            <p className="font-sans text-sm font-medium text-slate-100">ยังไม่มีรายการโปรด</p>
            <p className="mt-1 font-sans text-sm text-slate-500">
              กดไอคอนดาวข้างสินค้าที่ต้องการเพื่อเริ่มติดตาม
            </p>
            <Link
              href={serverPath(SERVER)}
              className="mt-4 inline-block rounded-lg bg-cyan-400 px-4 py-2 font-sans text-sm font-semibold text-[#050810] hover:bg-cyan-300"
            >
              ดูสินค้าทั้งหมด
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0b0f1c] shadow-[0_10px_30px_rgba(0,0,0,.35)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-left font-sans text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">สินค้า</th>
                  <th className="px-4 py-3 font-medium text-right">ราคาขาย</th>
                  <th className="px-4 py-3 font-medium text-right">ต่อสแตค</th>
                  <th className="px-4 py-3 font-medium text-right">อัปเดตล่าสุด</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {serverItems.map((item) => (
                  <tr key={serverItemIdentityKey(item.server, item.id)} className="border-b border-white/10 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <Link
                        prefetch={false}
                        href={serverPath(SERVER, `/item/${encodeURIComponent(item.id)}`)}
                        className="font-sans text-sm font-medium text-slate-100 hover:text-cyan-300"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right price-number text-sm text-emerald-400">
                      {formatCoinValue(item.sell)}
                    </td>
                    <td className="px-4 py-3 text-right price-number text-sm text-slate-300">
                      {formatCoinValue(item.stackPrice)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans text-xs text-slate-500">
                      {item.updated_at ? formatRelativeTime(item.updated_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        aria-label="นำออกจากรายการโปรด"
                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

export default function WatchlistPage() {
  return (
    <RequireAuth>
      <WatchlistBody />
    </RequireAuth>
  );
}
