'use client';

import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useWatchlistContext } from '@/lib/watchlist-context';

export function WatchStar({ server, itemId }: { server: string; itemId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const { isWatched, toggle } = useWatchlistContext();
  const [pending, setPending] = useState(false);
  const watched = isWatched(server, itemId);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      router.replace('/login');
      return;
    }

    setPending(true);
    try {
      await toggle(server, itemId);
    } catch {
      // WatchlistProvider already rolls back optimistic state on failure.
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={watched ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
      className="shrink-0 text-ink-400 transition-colors hover:text-brand-500 disabled:opacity-50"
    >
      <Star size={16} fill={watched ? '#22D3EE' : 'none'} className={watched ? 'text-brand-500' : ''} />
    </button>
  );
}
