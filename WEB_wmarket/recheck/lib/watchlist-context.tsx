'use client';

import { serverItemIdentityKey } from '@/lib/api';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { WatchlistItem } from './api';
import { useAuth } from './auth-context';

type WatchlistState = {
  items: WatchlistItem[];
  isWatched: (server: string, itemId: string) => boolean;
  loading: boolean;
  toggle: (server: string, itemId: string) => Promise<void>;
  remove: (item: WatchlistItem) => Promise<void>;
  refresh: () => void;
  loadError: string | null;
};

const WatchlistContext = createContext<WatchlistState | null>(null);

// Composite key — a user's watchlist can span multiple servers, and the
// same itemId can exist independently on each one, so the star's checked
// state must be scoped per (server, itemId), not just itemId.
function key(server: string, itemId: string): string {
  // Server identity is case-insensitive everywhere else in the app. Keep
  // the watchlist key consistent so `SIAM` and `siam` cannot split one
  // logical watch into two independent UI states.
  return serverItemIdentityKey(server, itemId);
}

/**
 * Mounted once at the root provider level (alongside AuthProvider). Fetches the signed-in
 * user's full watchlist exactly ONCE per sign-in / page load and shares it
 * via context.
 *
 * Why this exists: WatchStar used to call its own useWatchlist(server) hook
 * directly, so every row in ItemsTable/TrendingTable mounted its own
 * fetchWatchlist() call — e.g. 50 items on /items meant 50 identical
 * `auth`-only (no-store, per-user, uncacheable) reads to the backend/
 * Firestore for the exact same data. That's the real source of the extra
 * quota usage: unlike the public price/stat endpoints, watchlist reads are
 * per-user and can't go through Next's shared Data Cache, so N rows on
 * screen meant N reads, every single page load.
 *
 * Lifting the fetch up here means exactly one fetchWatchlist() call per
 * mount (or after a toggle/sign-in), no matter how many WatchStar buttons
 * are on the page — AND it also means app/watchlist/page.tsx (the full
 * watchlist table) reads from this same fetch instead of issuing its own
 * second, separate fetchWatchlist() call when the user lands on that page.
 */
export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  // Separate, star-only optimistic set. Kept apart from `items` so an
  // instant star click never has to fabricate fake price/name data just to
  // get an id into the "watched" set — it flips this set, `items` (the
  // thing the /watchlist table actually renders) only ever holds real
  // server data, filled in by refresh().
  // Per-key optimistic overrides. A single Set snapshot is unsafe when
  // two different mutations overlap: a refresh caused by mutation A could
  // clear the optimistic state for mutation B.
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, boolean>>(new Map());
  const optimisticOverridesRef = useRef(new Map<string, boolean>());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshRequestId = useRef(0);
  const mutationInFlight = useRef(new Set<string>());
  // window.setTimeout returns a number (DOM lib); the NodeJS.Timeout type
  // leaks in via mixed lib config and previously poisoned this Set's type.
  const reconciliationTimers = useRef(new Set<number>());

  const serverIds = useMemo(() => new Set(items.map((i) => key(i.server, i.id))), [items]);
  const ids = useMemo(() => {
    const next = new Set(serverIds);
    for (const [k, watched] of optimisticOverrides) {
      if (watched) next.add(k);
      else next.delete(k);
    }
    return next;
  }, [serverIds, optimisticOverrides]);

  const refresh = useCallback(() => {
    if (!user) {
      // Invalidate any request started for the previous account before
      // clearing its data. Otherwise a late response from the old user's
      // request could repopulate the watchlist after sign-out.
      ++refreshRequestId.current;
      setItems([]);
      optimisticOverridesRef.current = new Map();
      setOptimisticOverrides(new Map());
      setLoadError(null);
      setLoading(false);
      return;
    }
    const requestId = ++refreshRequestId.current;
    setLoading(true);
    setLoadError(null);
    api
      .fetchWatchlist()
      .then((next) => {
        if (requestId !== refreshRequestId.current) return;
        // Apply unresolved optimistic removals to the rendered rows too, not
        // only to the star state. Otherwise a stale backend read racing a
        // successful delete can briefly put the deleted row back into the
        // /watchlist table even though its star correctly remains off.
        const overridesSnapshot = optimisticOverridesRef.current;
        setItems(next.filter((item) => overridesSnapshot.get(key(item.server, item.id)) !== false));

        // Reconcile only overrides that the server now agrees with. Keep
        // unresolved overrides so a stale backend read cannot visibly undo
        // a successful mutation that is still propagating.
        const nextServerIds = new Set(next.map((i) => key(i.server, i.id)));
        setOptimisticOverrides((prev) => {
          const nextOverrides = new Map(prev);
          for (const [k, watched] of nextOverrides) {
            if (nextServerIds.has(k) === watched) nextOverrides.delete(k);
          }
          optimisticOverridesRef.current = nextOverrides;
          return nextOverrides;
        });
      })
      .catch((err) => {
        if (requestId === refreshRequestId.current) {
          setLoadError(err instanceof Error ? err.message : 'โหลดรายการโปรดไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (requestId === refreshRequestId.current) setLoading(false);
      });
  }, [user]);

  const scheduleReconciliation = useCallback(() => {
    const timer = window.setTimeout(() => {
      reconciliationTimers.current.delete(timer);
      refresh();
    }, 1_500);
    reconciliationTimers.current.add(timer);
  }, [refresh]);

  useEffect(() => () => {
    for (const timer of reconciliationTimers.current) window.clearTimeout(timer);
    reconciliationTimers.current.clear();
  }, []);

  // Re-fetch on sign-in/sign-out (not on every render) — `user` flips once
  // per auth transition, so this stays a single request per transition.
  // refresh() synchronizes with an external system (the watchlist API), so
  // this is a legitimate effect despite the setState calls inside it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (server: string, itemId: string) => {
      if (!user) {
        throw new Error('not-signed-in');
      }
      const k = key(server, itemId);
      if (mutationInFlight.current.has(k)) return;
      mutationInFlight.current.add(k);
      const watched = ids.has(k);

      // Optimistic star flip — instant feedback, no fake row data needed.
      const previousOverride = optimisticOverrides.get(k);
      setOptimisticOverrides((prev) => {
        const next = new Map(prev);
        next.set(k, !watched);
        optimisticOverridesRef.current = next;
        return next;
      });

      try {
        if (watched) {
          await api.removeFromWatchlist(server, itemId);
          setItems((prev) => prev.filter((i) => key(i.server, i.id) !== k));
        } else {
          await api.addToWatchlist(server, itemId);
          // One extra read here to get the real row (name/price) for the
          // /watchlist table — this only fires on an actual add action,
          // never on page load, so it doesn't reintroduce the N-per-page
          // problem this was built to fix.
          refresh();
          // A backend read immediately after the write can briefly be stale.
          // Reconcile once more after a short delay so the optimistic override
          // cannot remain indefinitely if the first read races propagation.
          scheduleReconciliation();
        }
      } catch (err) {
        // Roll back the optimistic star on failure.
        setOptimisticOverrides((prev) => {
          const next = new Map(prev);
          if (previousOverride === undefined) next.delete(k);
          else next.set(k, previousOverride);
          optimisticOverridesRef.current = next;
          return next;
        });
        throw err;
      } finally {
        mutationInFlight.current.delete(k);
      }
    },
    [ids, optimisticOverrides, user, refresh, scheduleReconciliation]
  );

  const remove = useCallback(async (item: WatchlistItem) => {
    const k = key(item.server, item.id);
    if (mutationInFlight.current.has(k)) return;
    mutationInFlight.current.add(k);
    setItems((prev) => prev.filter((i) => key(i.server, i.id) !== k));
    const previousOverride = optimisticOverrides.get(k);
    setOptimisticOverrides((prev) => {
      const next = new Map(prev);
      next.set(k, false);
      optimisticOverridesRef.current = next;
      return next;
    });
    try {
      await api.removeFromWatchlist(item.server, item.id);
      // Reconcile with the backend after a successful delete. A refresh that
      // raced with the mutation can otherwise restore the just-deleted row
      // from a stale read.
      refresh();
      scheduleReconciliation();
    } catch (err) {
      setItems((prev) => prev.some((i) => key(i.server, i.id) === k) ? prev : [...prev, item]);
      setOptimisticOverrides((prev) => {
        const next = new Map(prev);
        if (previousOverride === undefined) next.delete(k);
        else next.set(k, previousOverride);
        optimisticOverridesRef.current = next;
        return next;
      });
      throw err;
    } finally {
      mutationInFlight.current.delete(k);
    }
  }, [optimisticOverrides, refresh, scheduleReconciliation]);

  const isWatched = useCallback((server: string, itemId: string) => ids.has(key(server, itemId)), [ids]);

  return (
    <WatchlistContext.Provider value={{ items, isWatched, loading, toggle, remove, refresh, loadError }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlistContext(): WatchlistState {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlistContext must be used within WatchlistProvider');
  return ctx;
}
