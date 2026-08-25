'use client';

/**
 * Light / Dark / Auto theme (v19).
 *
 * - 'light' | 'dark' are explicit user choices (persisted).
 * - 'auto' follows the local clock: light 06:00–17:59, dark otherwise,
 *   and re-evaluates every minute — so the site "wakes up" with you.
 *
 * The resolved theme is applied as <html data-theme="…">; globals.css
 * carries the light-mode shim that re-points this app's dark utility
 * classes, so the whole site flips from one attribute.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'auto';
const STORAGE_KEY = 'wm-theme';

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** Hour-based auto mode: daylight hours get the light surface. */
function autoThemeForHour(hour: number): 'light' | 'dark' {
  return hour >= 6 && hour < 18 ? 'light' : 'dark';
}

function resolve(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'auto') return autoThemeForHour(new Date().getHours());
  return pref;
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initializers adopt the stored preference synchronously on the
  // client (the pre-paint inline script already applied data-theme), so
  // there is no effect-time setState and no flash.
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'auto';
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    typeof window === 'undefined' ? 'dark' : resolve(preference),
  );

  // Mirror the resolved theme onto <html> whenever it changes (mount included).
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // Keep 'auto' ticking with the clock, and honor OS changes in light/dark.
  useEffect(() => {
    if (preference !== 'auto') return;
    const tick = () => {
      const next = resolve('auto');
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    // Enable a short global cross-fade so surfaces glide instead of snapping.
    const root = document.documentElement;
    root.classList.add('theme-switching');
    window.setTimeout(() => root.classList.remove('theme-switching'), 420);
    setPreferenceState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const r = resolve(next);
    setResolved(r);
    document.documentElement.dataset.theme = r;
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
