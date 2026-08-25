'use client';

/**
 * Shared motion primitives (v18 renovation).
 *
 * One vocabulary of motion for the whole site:
 *  - <Reveal>         soft fade-up entrance on scroll, staggerable via `delay`
 *  - <AnimatedNumber> counts between numeric values (market feel)
 *  - <Skeleton>       shimmering placeholder block
 *  - <EmptyState>     consistent "nothing here" treatment
 *
 * Everything respects prefers-reduced-motion: globals.css neutralizes CSS
 * animations globally under that preference, and <Reveal> renders a plain
 * div there via framer-motion's useReducedMotion().
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { animate, LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';

/** The site's single easing curve — soft start, gentle landing. */
export const EASE: [number, number, number, number] = [0.22, 0.9, 0.28, 1];

/** Load only the tiny DOM-animation feature bundle of framer-motion.
    With LazyMotion's `strict` mode every animated element must use `m.*`. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict>{children}</LazyMotion>;
}

type RevealProps = {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
} & Omit<HTMLMotionProps<'div'>, 'children'>;

export function Reveal({ children, delay = 0, y = 14, className, ...rest }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </m.div>
  );
}

const noopFormat = (n: number) => String(Math.round(n));

/**
 * Counts from the previous value to the new one whenever `value` changes.
 * Renders into a span imperatively so live price ticks never re-render
 * their React subtree — important on pages full of moving numbers.
 */
export function AnimatedNumber({
  value,
  format = noopFormat,
  duration = 0.7,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !Number.isFinite(value)) return;
    // First paint shows the value directly — no 0 → x count-up spam when a
    // page hydrates long after its data was fetched.
    if (prev.current === null || !Number.isFinite(prev.current)) {
      node.textContent = format(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    if (from === value) return;
    const controls = animate(from, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        node.textContent = format(v);
      },
      onComplete: () => {
        prev.current = value;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className} aria-live="off">
      {format(value)}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="anim-fade-up px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-400">
        {icon ?? '⌕'}
      </div>
      <p className="text-sm font-bold text-slate-200">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}
