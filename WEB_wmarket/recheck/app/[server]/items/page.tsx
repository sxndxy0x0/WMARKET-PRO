import { redirect } from 'next/navigation';
import { resolveServerName, decodeServerSegment, serverPath } from '@/lib/api';

// Legacy /items route: validate and canonicalize the server before redirecting,
// so malformed/unknown server segments never become redirect targets.
export default async function ItemsRedirect({ params }: { params: Promise<{ server: string }> }) {
  const { server: encodedServer } = await params;
  const requestedServer = decodeServerSegment(encodedServer);
  const server = await resolveServerName(requestedServer);
  if (!server) {
    redirect('/');
  }
  redirect(serverPath(server, '/market'));
}
