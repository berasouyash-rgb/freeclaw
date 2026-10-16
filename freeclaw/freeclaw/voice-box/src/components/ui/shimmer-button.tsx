/**
 * ShimmerButton — Premium CTA with a static soft sheen.
 *
 * Based on Magic UI's ShimmerButton pattern. The sweep animation was
 * removed platform-wide (no left-to-right motion); the sheen layer stays
 * parked off-screen so the button keeps its gradient styling.
 */

import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ShimmerButtonProps {
  children: ReactNode;
  onClick?: () => void;
  shimmerColor?: string;
  shimmerSize?: string;
  shimmerDuration?: string;
  borderRadius?: string;
  background?: string;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  "aria-label"?: string;
}

export default function ShimmerButton({
  children,
  onClick,
  shimmerColor = "rgba(255, 255, 255, 0.4)",
  shimmerSize = "0.05em",
  shimmerDuration = "3s",
  borderRadius = "100px",
  background = "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)",
  className = "",
  disabled = false,
  type = "button",
  "aria-label": ariaLabel,
}: ShimmerButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "group relative z-0 cursor-pointer overflow-hidden border-0 p-0",
        "text-white font-semibold",
        "transition-transform duration-200 ease-out",
        "hover:scale-[1.02] active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400",
        disabled && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100",
        className
      )}
      style={{
        borderRadius,
        background,
        ["--shimmer-color" as string]: shimmerColor,
        ["--shimmer-size" as string]: shimmerSize,
        ["--shimmer-duration" as string]: shimmerDuration,
      }}
    >
      {/* Shimmer sweep overlay */}
      <span
        aria-hidden
        className="absolute inset-0 z-10 overflow-hidden pointer-events-none"
        style={{ borderRadius }}
      >
        <span
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, transparent 0%, var(--shimmer-color) 50%, transparent 100%)`,
            transform: "translateX(-100%)",
          }}
        />
      </span>
      {/* Button content */}
      <span className="relative z-20 flex items-center justify-center gap-2 px-6 py-3">
        {children}
      </span>
    </button>
  );
}
