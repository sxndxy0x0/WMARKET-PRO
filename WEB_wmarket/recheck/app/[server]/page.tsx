import { redirect } from 'next/navigation';
import Link from 'next/link';
import { fetchPrices, fetchStats, resolveServerName, decodeServerSegment, serverIdentityKey, serverPath } from '@/lib/api';
import { DashboardClient } from '@/components/DashboardClient';

// Was `export const dynamic = 'force-dynamic'` — that made EVERY page
// load/refresh/navigation (by anyone, even without touching the game) hit
// the backend live with no caching. Price data only actually changes when
// the in-game mod syncs, so ISR is the right fit here: Next.js serves this
// page from its Data Cache and re-fetches at most once per
// `revalidate` seconds — shared across ALL visitors, not per-visitor.
// Real-time-feeling updates come from the WebSocket listener in
// components/LiveRefresh.tsx (mounted in the server layout), which calls
// router.refresh() the moment the backend actually broadcasts new prices,
// so users aren't stuck waiting out this window for a sync they just did.
export const revalidate = 15;

export default async function HomePage({ params }: { params: Promise<{ server: string }> }) {
  const { server: encodedServer } = await params;
  const requestedServer = decodeServerSegment(encodedServer);
  const server = await resolveServerName(requestedServer);

  if (!server) {
    return (
      <div className="min-h-screen p-6">
        <Link href="/" className="font-sans text-sm text-slate-500 hover:text-cyan-300">← กลับไปเลือกรายการเซิร์ฟเวอร์</Link>
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 font-sans text-sm text-slate-100">ไม่พบเซิร์ฟเวอร์นี้ใน Backend</div>
      </div>
    );
  }

  // Canonicalize by identity, not raw string — slug segments and legacy full
  // names both normalize here, so a pretty-slug URL no longer redirects to
  // itself (which used to loop SSR → blank page).
  if (serverIdentityKey(requestedServer) !== serverIdentityKey(server)) redirect(serverPath(server));

  let loadError: string | null = null;
  let items: Awaited<ReturnType<typeof fetchPrices>> = [];
  let stats: Awaited<ReturnType<typeof fetchStats>> | null = null;

  try {
    [items, stats] = await Promise.all([
      fetchPrices(server),
      fetchStats(server),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to reach the backend.';
  }

  if (loadError || !stats) {
    return (
      <div className="min-h-screen p-6">
        <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 font-sans text-sm text-slate-100">
          เชื่อมต่อ backend ไม่สำเร็จ ({loadError}) ตรวจสอบว่า{' '}
          <code className="font-sans text-cyan-300">NEXT_PUBLIC_API_URL</code> ชี้ไปที่ Price Sync backend ที่กำลังทำงานอยู่
        </div>
      </div>
    );
  }

  return (
    <DashboardClient server={server} initialItems={items} stats={stats} />
  );
}
