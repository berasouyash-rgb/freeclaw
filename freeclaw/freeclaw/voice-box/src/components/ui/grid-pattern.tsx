/**
 * GridPattern — Subtle SVG grid pattern for hero sections and backgrounds.
 *
 * Based on Magic UI's GridPattern. Renders a grid of squares via SVG,
 * masked to a radial gradient so it fades at the edges.
 */

import { useMemo } from "react";
import { cn } from "../../lib/utils";

interface GridPatternProps {
  /** Number of columns */
  cols?: number;
  /** Number of rows */
  rows?: number;
  /** Randomly filled squares as [col, row] pairs */
  squares?: [number, number][];
  /** Width of each cell */
  cellWidth?: number;
  /** Height of each cell */
  cellHeight?: number;
  /** Gap between cells */
  gap?: number;
  className?: string;
}

export default function GridPattern({
  cols = 20,
  rows = 12,
  squares,
  cellWidth = 40,
  cellHeight = 40,
  gap = 4,
  className = "",
}: GridPatternProps) {
  const filledSquares = useMemo(() => {
    if (squares) return squares;
    // Seeded pseudo-random to avoid flicker on re-render
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return seed / 2147483647;
    };
    const result: [number, number][] = [];
    const total = Math.floor(cols * rows * 0.15);
    for (let i = 0; i < total; i++) {
      result.push([
        Math.floor(rand() * cols),
        Math.floor(rand() * rows),
      ]);
    }
    return result;
  }, [squares, cols, rows]);

  const _svgWidth = cols * (cellWidth + gap);
  const _svgHeight = rows * (cellHeight + gap);

  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="grid-mask" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="grid-fade">
          <rect width="100%" height="100%" fill="url(#grid-mask)" />
        </mask>
      </defs>
      <g mask="url(#grid-fade)">
        {filledSquares.map(([col, row], i) => (
          <rect
            key={i}
            x={col * (cellWidth + gap)}
            y={row * (cellHeight + gap)}
            width={cellWidth}
            height={cellHeight}
            rx={3}
            className="fill-current opacity-[0.08]"
          />
        ))}
      </g>
    </svg>
  );
}
