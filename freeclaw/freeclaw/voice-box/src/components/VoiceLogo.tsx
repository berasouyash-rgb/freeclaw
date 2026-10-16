import { useId } from "react";

interface VoiceLogoProps {
  /** Rendered pixel size (square). Defaults to 36. */
  size?: number;
  /** Radiating sound-wave animation. Defaults to true. */
  animated?: boolean;
  /** Accessible name. Omit for decorative use (aria-hidden). */
  label?: string;
  className?: string;
}

/**
 * Voice Flow logo mark — speaker figure with radiating sound arcs on the
 * brand gradient tile. Original art for this codebase (purple speaker +
 * waves motif). Motion is opacity/scale only (GPU-cheap); pass
 * animated={false} for static contexts and users with reduced-motion
 * preferences (CSS also kills the animation globally).
 */
export default function VoiceLogo({
  size = 36,
  animated = true,
  label,
  className = "",
}: VoiceLogoProps) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`${animated ? "vb-logo-anim" : "vb-logo-static"} ${className}`}
    >
      <defs>
        <linearGradient
          id={`vblogo-${gid}`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#8b85f5" />
          <stop offset="58%" stopColor="#5652d6" />
          <stop offset="100%" stopColor="#4038c7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#vblogo-${gid})`} />
      <g fill="#ffffff">
        <circle cx="23" cy="23" r="8.5" />
        <path d="M9 51 C9 42 15 38 23 38 C31 38 37 42 37 51 Z" />
      </g>
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        className="vb-logo-arcs"
      >
        <path d="M40.4 22 A13 13 0 0 1 40.4 42" />
        <path d="M44.9 16.7 A20 20 0 0 1 44.9 47.3" />
        <path d="M49.3 11.3 A27 27 0 0 1 49.3 52.7" />
      </g>
    </svg>
  );
}
