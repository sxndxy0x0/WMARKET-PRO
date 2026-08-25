import { redirect } from 'next/navigation';
import Link from 'next/link';
import { fetchPrices, resolveServerName, decodeServerSegment, serverIdentityKey, serverPath } from '@/lib/api';
import { ItemsPageClient } from '@/components/ItemsPageClient';

// See app/page.tsx for why this is ISR (`revalidate`) instead of
// `force-dynamic` — same reasoning applies to every public price page.
export const revalidate = 15;

export default async function MarketPage({ params }: { params: Promise<{ server: string }> }) {
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

  // Identity-based canonicalization — prevents slug-URL self-redirect loops.
  if (serverIdentityKey(requestedServer) !== serverIdentityKey(server)) redirect(serverPath(server));

  let items: Awaited<ReturnType<typeof fetchPrices>> = [];
  let loadError: string | null = null;

  try {
    items = await fetchPrices(server);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to reach the backend.';
  }

  if (loadError) {
    return (
      <div className="min-h-screen p-6">
        <Link href={serverPath(server)} className="font-sans text-sm text-slate-500 hover:text-cyan-300">
          ← กลับไปหน้าหลัก
        </Link>
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 font-sans text-sm text-slate-100">
          เชื่อมต่อ backend ไม่สำเร็จ ({loadError})
        </div>
      </div>
    );
  }

  return <ItemsPageClient server={server} items={items} />;
}
