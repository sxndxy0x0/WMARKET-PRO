'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchHistory } from '@/lib/api';
import { ensureSparklineLoaded, getSparklineCacheEntry, subscribeSparkline } from '@/lib/sparkline-cache';
import { Sparkline } from './Sparkline';

export function LazySparkline({ itemId, server }: { itemId: string; server: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);

  useEffect(() => subscribeSparkline(itemId, () => forceRender((n) => n + 1), server), [itemId, server]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const load = async () => {
      await ensureSparklineLoaded(itemId, server, fetchHistory);
      if (cancelled) return;
      const entry = getSparklineCacheEntry(itemId, server);
      if (entry?.status === 'error') {
        // Retry after the cache's error backoff instead of requiring a full page refresh.
        retryTimer = setTimeout(load, 30_500);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void load();
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [itemId, server]);

  const entry = getSparklineCacheEntry(itemId, server);

  return (
    <div ref={ref} className="h-8 w-16">
      {!entry || entry.status === 'loading' ? (
        <div className="skeleton h-8 w-16 rounded bg-transparent" />
      ) : entry.status === 'error' ? (
        <div className="h-8 w-16" />
      ) : (
        <Sparkline points={entry.points} className="h-8 w-16" />
      )}
    </div>
  );
}
