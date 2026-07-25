import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

/**
 * Animated trend badge: ▲ green when up, ▼ red when down (invert for metrics where down is good).
 */
export default function Trend({ current, previous, invert = false, label }: { current: number; previous: number; invert?: boolean; label?: string }) {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : current > 0 ? 100 : 0;
  const up = diff > 0;
  const flat = diff === 0;
  const good = flat ? null : invert ? !up : up;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full vb-pop ${
        flat ? 'bg-surface2 text-ink3' : good ? 'bg-good/12 text-good' : 'bg-bad/12 text-bad'
      }`}
      title={label || `vs previous period: ${diff > 0 ? '+' : ''}${diff}`}
      aria-label={`Trend ${flat ? 'flat' : up ? 'up' : 'down'} ${Math.abs(pct)} percent`}
    >
      {flat ? <Minus size={10} /> : up ? <ArrowUp size={10} className="vb-trend-bounce" /> : <ArrowDown size={10} className="vb-trend-bounce" />}
      {flat ? '0%' : `${Math.abs(pct)}%`}
    </span>
  );
}

/** Tiny inline SVG sparkline with animated draw-in */
export function Sparkline({ data, color = 'var(--vb-accent)', width = 96, height = 28 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data);
  const step = width / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  const path = `M${pts.join(' L')}`;
  const areaPath = `${path} L${width},${height} L0,${height} Z`;
    const last = pts[pts.length - 1];
  if (!last) return null;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={areaPath} fill={color} opacity="0.10" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="vb-draw" pathLength={1} />
      <circle cx={last.split(',')[0]} cy={last.split(',')[1]} r="2.5" fill={color} className="vb-pop" />
    </svg>
  );
}
