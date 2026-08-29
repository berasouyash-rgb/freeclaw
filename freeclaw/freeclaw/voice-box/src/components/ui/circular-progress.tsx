/**
 * CircularProgress — animated SVG ring with smooth fill animation.
 * Used for community health, resolution rate, and other percentage metrics.
 */
import { memo, useEffect, useState } from "react";
import { cn } from "../../lib/utils";

interface CircularProgressProps {
  value: number; // 0–100
  size?: number; // px
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  className?: string;
  animate?: boolean;
}

function CircularProgressInner({
  value,
  size = 120,
  strokeWidth = 8,
  color = "var(--vb-accent)",
  trackColor = "var(--vb-surface2)",
  label,
  sublabel,
  className,
  animate = true,
}: CircularProgressProps) {
  const [mounted, setMounted] = useState(false);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  useEffect(() => {
    if (animate) {
      // Trigger animation on next frame after mount
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    setMounted(true);
  }, [animate]);

  const colorByValue =
    clamped >= 70
      ? "var(--vb-good)"
      : clamped >= 40
        ? "var(--vb-warn)"
        : "var(--vb-bad)";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progress: ${clamped}%`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        {/* Track (background ring) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color || colorByValue}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? offset : circumference}
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        {/* Glow effect behind the arc end */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color || colorByValue}
          strokeWidth={strokeWidth + 6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? offset : circumference}
          opacity={0.15}
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: "blur(4px)",
          }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-2xl leading-none" style={{ color: color || colorByValue }}>
          {clamped}
        </span>
        {label && (
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink3 mt-0.5">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="text-[8px] text-ink3 mt-0.5">{sublabel}</span>
        )}
      </div>
    </div>
  );
}

export const CircularProgress = memo(CircularProgressInner);
export default CircularProgress;
