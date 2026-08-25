'use client';

import { createContext, useContext, useState } from 'react';

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting';

type LiveStatusContextValue = {
  status: LiveStatus;
  setStatus: (status: LiveStatus) => void;
};

const LiveStatusContext = createContext<LiveStatusContextValue | null>(null);

export function LiveStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  return <LiveStatusContext.Provider value={{ status, setStatus }}>{children}</LiveStatusContext.Provider>;
}

/** Returns 'connecting' (a safe, honest default) outside a provider. */
export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext)?.status ?? 'connecting';
}

/** Internal — only LiveRefresh should call this. */
export function useSetLiveStatus(): (status: LiveStatus) => void {
  const ctx = useContext(LiveStatusContext);
  return ctx?.setStatus ?? (() => {});
}
