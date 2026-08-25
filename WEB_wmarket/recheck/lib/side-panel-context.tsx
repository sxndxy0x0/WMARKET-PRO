'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type SidePanelContextValue = {
  openItemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
};

const SidePanelContext = createContext<SidePanelContextValue | null>(null);

export function SidePanelProvider({ children }: { children: React.ReactNode }) {
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const open = useCallback((itemId: string) => setOpenItemId(itemId), []);
  const close = useCallback(() => setOpenItemId(null), []);

  const value = useMemo(() => ({ openItemId, open, close }), [openItemId, open, close]);

  return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
}

/** Returns null outside a provider so callers (e.g. ItemsTable used from a
 * page that hasn't opted in yet) can fall back to normal <Link> navigation
 * instead of crashing. */
export function useSidePanel(): SidePanelContextValue | null {
  return useContext(SidePanelContext);
}
