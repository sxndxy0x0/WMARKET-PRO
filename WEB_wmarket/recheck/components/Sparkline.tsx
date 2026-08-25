import { HistoryPoint } from '@/lib/api';

/**
 * Inline mini-chart for table rows. Renders the sell series as a filled
 * area with an end-point dot, colored by trend (green when the latest
 * price is at/above the first, red otherwise) — at a glance the whole
 * column reads as a market heatmap without any labels.
 */
export function Sparkline({ points, className = 'h-10 w-24' }: { points: HistoryPoint[]; className?: string }) {
  const values = points.map((p) => p.sell).filter((v) => Number.isFinite(v) && v >= 0);
  if (values.length < 2) return <div className={`${className} rounded-lg bg-white/5`} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map(
    (v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(32 - ((v - min) / range) * 28).toFixed(1)}`
  );
  const last = coords[coords.length - 1].split(',');
  const up = values[values.length - 1] >= values[0];
  // Trend colors match the app's emerald/red change badges.
  const stroke = up ? '#34d399' : '#f87171';
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className={`${className} spark-reveal overflow-visible`} aria-hidden="true">
      {/* Baseline hairline anchors the shape when the series is short. */}
      <line x1="0" y1="35.5" x2="100" y2="35.5" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
      <polygon
        points={`0,36 ${coords.join(' ')} 100,36`}
        fill={stroke}
        opacity="0.14"
        stroke="none"
      />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}
