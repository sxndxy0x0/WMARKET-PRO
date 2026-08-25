'use client';

import { useMemo, useState } from 'react';

export function MinecraftIcon({
  id,
  size = 20,
  className = '',
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const src = useMemo(() => `/api/minecraft-icon?${new URLSearchParams({ id, name: id }).toString()}`, [id]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className={`inline-block shrink-0 rounded-[3px] border border-border bg-surface-sunken ${className}`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ imageRendering: 'pixelated', width: size, height: size }}
      className={`inline-block shrink-0 ${className}`}
      onError={() => setFailedSrc(src)}
    />
  );
}
