'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getWebSocketUrl, serverIdentityKey } from '@/lib/api';
import { useSetLiveStatus } from '@/lib/live-status-context';

/**
 * Mounted once in each active server layout. Renders nothing — it's purely a data
 * event listener.
 *
 * Why this exists: the pages (app/page.tsx, app/market/page.tsx, etc.) are
 * ISR (`export const revalidate = 15`), which bounds backend/Firestore
 * reads to at most once per 15s shared across all visitors — that's what
 * actually fixed the read-quota problem. But ISR alone means a price sync
 * that just happened could take up to 15s to show up for someone already
 * looking at the page. This component closes that gap: the backend
 * broadcasts a `price_update` over WebSocket the instant a sync lands
 * (see backend/websocket/hub.js + controllers/pricesController.js), and
 * this listener calls app/api/revalidate (which purges the specific cached
 * entries via revalidateTag) followed by router.refresh() — the tag purge
 * is required; router.refresh() alone does NOT bypass Next's Data Cache,
 * it would just re-render with the same cached data until the 15s window
 * happened to elapse on its own.
 *
 * This does NOT bring back the original problem: it only fires on real
 * write events from the game, not on a timer, so idle visitors generate
 * zero extra reads no matter how long the tab stays open.
 */
export function LiveRefresh({ server }: { server: string }) {
  const router = useRouter();
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(true);
  const setLiveStatus = useSetLiveStatus();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shouldReconnect.current = true;
    let socket: WebSocket | null = null;
    let openedAt = 0;

    function scheduleRefresh() {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        fetch('/api/revalidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server }),
        })
          .catch(() => {})
          .finally(() => router.refresh());
      }, 1100);
    }

    function connect() {
      if (!shouldReconnect.current) return;

      try {
        socket = new WebSocket(getWebSocketUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        openedAt = Date.now();
        reconnectAttempt.current = 0; // connection recovered — reset backoff
        setLiveStatus('connected');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (
            msg.type === 'price_update' &&
            typeof msg.data?.server === 'string' &&
            serverIdentityKey(msg.data.server) === serverIdentityKey(server)
          ) {
            // Purge the Next.js Data Cache first (see app/api/revalidate),
            // THEN ask Next.js to re-render — router.refresh() alone would
            // just re-render with the same cached data if the `revalidate`
            // window hadn't naturally elapsed yet.
            scheduleRefresh();
          }
        } catch {
          // ignore malformed frames (e.g. the initial {type:'connected'} is
          // fine to ignore too — nothing to refresh yet)
        }
      };

      socket.onclose = () => {
        if (Date.now() - openedAt > 4_000) setLiveStatus('reconnecting');
        if (shouldReconnect.current) scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose fires right after — let that path own reconnect scheduling
        socket?.close();
      };
    }

    function scheduleReconnect() {
      // Exponential backoff capped at 30s with a 1s floor, so a flapping
      // backend can't turn into its own request storm either.
      const delay = Math.max(1_000, Math.min(30_000, 1000 * 2 ** reconnectAttempt.current));
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      socket?.close();
    };
  }, [server, router, setLiveStatus]);

  return null;
}
