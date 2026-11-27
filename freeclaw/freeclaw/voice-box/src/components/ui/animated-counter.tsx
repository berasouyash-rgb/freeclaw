/**
 * AnimatedCounter — Enhanced number animation with prefix, suffix, separator, and label.
 *
 * Builds on the existing CountUp component with Magic UI-style presentation.
 * Wraps the animated number in a visually rich container with optional label,
 * icon, and trend indicator.
 */

import { memo } from "react";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import CountUp from "../CountUp";
import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

interface AnimatedCounterProps {
  /** Target value */
  value: number;
  /** Text before the number */
  prefix?: string;
  /** Text after the number */
  suffix?: string;
  /** Label below the number */
  label?: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Optional trend indicator */
  trend?: { value: number; positive?: boolean };
  /** Animation duration in ms */
  duration?: number;
  /** Decimal places */
  decimals?: number;
  /** Color accent */
  accent?: "violet" | "cyan" | "gold" | "green" | "red" | "default";
  className?: string;
  /** Label className */
  labelClassName?: string;
}

const ACCENT_CLASSES: Record<string, string> = {
  violet: "text-violet-400",
  cyan: "text-cyan-400",
  gold: "text-amber-400",
  green: "text-emerald-400",
  red: "text-red-400",
  default: "text-ink1",
};

const BG_ACCENT_CLASSES: Record<string, string> = {
  violet: "bg-violet-500/10",
  cyan: "bg-cyan-500/10",
  gold: "bg-amber-500/10",
  green: "bg-emerald-500/10",
  red: "bg-red-500/10",
  default: "bg-surface2",
};

export default memo(function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  label,
  icon,
  trend,
  duration = 1200,
  decimals: _decimals = 0,
  accent = "default",
  className = "",
  labelClassName = "",
}: AnimatedCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
      transition={{ duration: 0.2, ease: "linear" }}
      className={cn("flex flex-col items-center gap-1", className)}
    >
      {/* Icon + Number */}
      <div className={cn(
        "flex items-center gap-2 rounded-xl px-4 py-2",
        BG_ACCENT_CLASSES[accent],
      )}>
        {icon && (
          <span className={cn("flex-shrink-0", ACCENT_CLASSES[accent])}>
            {icon}
          </span>
        )}
        <span className={cn("text-3xl font-bold tabular-nums tracking-tight", ACCENT_CLASSES[accent])}>
          {prefix}
          {isInView ? (
            <CountUp value={value} suffix={suffix} duration={duration} />
          ) : (
            <span>{prefix}0{suffix}</span>
          )}
        </span>
      </div>

      {/* Label */}
      {label && (
        <span className={cn(
          "text-sm font-medium text-ink3",
          labelClassName,
        )}>
          {label}
        </span>
      )}

      {/* Trend */}
      {trend && (
        <span className={cn(
          "text-xs font-medium",
          trend.positive !== false ? "text-emerald-400" : "text-red-400",
        )}>
          {trend.positive !== false ? "↑" : "↓"} {Math.abs(trend.value)}%
        </span>
      )}
    </motion.div>
  );
});
