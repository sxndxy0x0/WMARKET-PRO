'use client';

import { useMemo, useState } from 'react';
import { baseItemId } from '@/lib/items';

function iconUrl(id: string, name: string) {
  // Lookup by the stable base id — variant fragments (`potion#variant-…`)
  // never correspond to a texture file and would poison every candidate
  // name the icon route generates.
  const params = new URLSearchParams({ id: baseItemId(id), name });
  return `/api/minecraft-icon?${params.toString()}`;
}

export function ItemIcon({ id, name, size = 32, className = '' }: { id: string; name: string; size?: number; className?: string }) {
  const src = useMemo(() => iconUrl(id, name), [id, name]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed) {
    return (
      <span title={name} className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[10px] font-black uppercase text-slate-500 ${className}`} style={{ width: size, height: size }} aria-hidden>
        {name.slice(0, 1)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`shrink-0 object-contain ${className}`}
      style={{ imageRendering: 'pixelated', width: size, height: size }}
      onError={() => setFailedSrc(src)}
    />
  );
}
