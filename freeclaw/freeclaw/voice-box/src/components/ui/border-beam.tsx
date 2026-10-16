/**
 * BorderBeam — Animated border beam that orbits a card's perimeter.
 *
 * Based on Magic UI's BorderBeam. Uses a conic gradient masked to a ring,
 * animated via CSS keyframes. Pure CSS — no JS runtime cost.
 *
 * Usage: wrap around any card/container:
 *   <div className="relative overflow-hidden">
 *     <CardContent />
 *     <BorderBeam />
 *   </div>
 */

import { cn } from "../../lib/utils";

interface BorderBeamProps {
  /** Orbit duration in seconds */
  duration?: number;
  /** Size of the beam in px */
  size?: number;
  /** Distance from the edge */
  offset?: number;
  /** Color stops */
  colorFrom?: string;
  colorTo?: string;
  /** Pause on hover */
  pauseOnHover?: boolean;
  className?: string;
}

export default function BorderBeam({
  duration = 8,
  size = 100,
  offset: _offset = 0,
  colorFrom = "#6366f1",
  colorTo = "#a78bfa",
  pauseOnHover = false,
  className = "",
}: BorderBeamProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10",
        "rounded-[inherit]",
        "[mask-image:conic-gradient(from_0deg,transparent_70%,white)]",
        "[padding:1px]",
        pauseOnHover && "group-hover:[animation-play-state:paused]",
        className
      )}
      style={{
        width: size,
        height: size,
        top: `calc(50% - ${size / 2}px)`,
        left: `calc(50% - ${size / 2}px)`,
        animation: `border-beam-rotate ${duration}s linear infinite`,
        background: `conic-gradient(from var(--beam-angle, 0deg), ${colorFrom}, ${colorTo}, transparent 70%)`,
        ["--beam-size" as string]: `${size}px`,
      }}
    >
      <span
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background: `conic-gradient(from var(--beam-angle, 0deg), ${colorFrom}, ${colorTo}, transparent 70%)`,
          mask: "radial-gradient(farthest-side, transparent calc(100% - 1px), white calc(100% - 1px))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 1px), white calc(100% - 1px))",
        }}
      />
    </span>
  );
}
