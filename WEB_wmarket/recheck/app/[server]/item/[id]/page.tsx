import { redirect } from 'next/navigation';
import Link from 'next/link';
import { fetchHistory, resolveServerName, decodeServerSegment, serverIdentityKey, serverPath } from '@/lib/api';
import { ItemDetailClient } from '@/components/ItemDetailClient';

// See app/page.tsx for why this is ISR (`revalidate`) instead of
// `force-dynamic` — same reasoning applies to every public price page.
// Dynamic segments (the [id]) are cached per-id on first request, same as
// any other ISR page — no generateStaticParams needed for this to work.
export const revalidate = 15;

export default async function ItemPage({ params }: { params: Promise<{ server: string; id: string }> }) {
  const { server: encodedServer, id: encodedId } = await params;
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

  // Same Next 16 behavior as the server segment: dynamic params arrive
  // percent-encoded, so an id like `minecraft:potion#variant-…` is received
  // as `%23variant-…` and must be decoded before any backend lookup.
  let id = encodedId;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    // Malformed percent sequence — keep the raw value; the backend will
    // simply report no history for it.
  }

  // Identity-based canonicalization — prevents slug-URL self-redirect loops.
  if (serverIdentityKey(requestedServer) !== serverIdentityKey(server)) redirect(serverPath(server, `/item/${encodeURIComponent(id)}`));

  let history: Awaited<ReturnType<typeof fetchHistory>> = [];
  let loadError: string | null = null;

  try {
    history = await fetchHistory(server, id, 500);
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

  return <ItemDetailClient id={id} server={server} history={history} />;
}
