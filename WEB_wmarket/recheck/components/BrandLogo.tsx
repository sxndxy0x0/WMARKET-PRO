import Link from 'next/link';
import { serverPath } from '@/lib/api';

export function BrandLogo({ link = true, server }: { link?: boolean; server?: string }) {
  const content = (
    <span className="flex items-center gap-2.5">
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-400 text-[#050810] shadow-[0_0_16px_rgba(34,211,238,.35)]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 36 36" className="h-7 w-7" fill="none">
          <path d="M8 9v18M8 9l10 13L28 9v18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 28h17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
        </svg>
      </span>
      <span className="hidden text-[15px] font-extrabold tracking-tight text-slate-100 sm:block">
        W<span className="text-cyan-300">Market</span>
      </span>
    </span>
  );

  return link ? <Link prefetch={false} href={server ? serverPath(server) : '/'} aria-label="WMarket หน้าหลัก">{content}</Link> : content;
}
