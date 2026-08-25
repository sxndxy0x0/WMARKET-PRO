import { LiveRefresh } from '@/components/LiveRefresh';
import { resolveServerName, decodeServerSegment } from '@/lib/api';

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ server: string }>;
}) {
  const { server: encodedServer } = await params;
  const requestedServer = decodeServerSegment(encodedServer);
  const server = await resolveServerName(requestedServer);

  // Unknown server routes are rejected by the page itself. Do not start a
  // WebSocket reconnect loop for an invalid/unregistered route while that
  // rejection is happening.
  return (
    <>
      {server ? <LiveRefresh server={server} /> : null}
      {children}
    </>
  );
}
