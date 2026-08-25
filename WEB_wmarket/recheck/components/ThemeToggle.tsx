'use client';

import { Sun, Moon, SunMoon } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/lib/theme-context';

const ORDER: ThemePreference[] = ['light', 'dark', 'auto'];

const META: Record<ThemePreference, { label: string; icon: React.ReactNode }> = {
  light: { label: 'โหมดกลางวัน', icon: <Sun size={17} /> },
  dark: { label: 'โหมดกลางคืน', icon: <Moon size={17} /> },
  auto: { label: 'อัตโนมัติตามเวลา', icon: <SunMoon size={17} /> },
};

/** Cycles light → dark → auto. The active mode is what the user picked,
    not the resolved one, so the button always shows their intent. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
  const current = META[preference] ?? META.auto;
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      title={`${current.label} — คลิกเพื่อสลับเป็น${META[next].label}`}
      aria-label={`ธีมปัจจุบัน: ${current.label} คลิกเพื่อเปลี่ยน`}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-slate-400 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-cyan-300"
    >
      {current.icon}
    </button>
  );
}
