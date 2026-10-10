/**
 * AnimatedList — Staggered list entrance animation.
 *
 * Based on React Bits' AnimatedList. Items fade and slide in with
 * configurable stagger delay. Uses framer-motion for spring physics.
 *
 * Usage:
 *   <AnimatedList>
 *     <Item key="1" />
 *     <Item key="2" />
 *   </AnimatedList>
 */

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface AnimatedListProps {
  children: ReactNode;
  /** Base delay between items in seconds */
  staggerDelay?: number;
  /** Initial delay before first item (seconds) */
  initialDelay?: number;
  /** Animation direction */
  direction?: "up" | "down" | "left" | "right";
  /** Distance to travel in px */
  distance?: number;
  className?: string;
}

export default function AnimatedList({
  children,
  staggerDelay = 0.06,
  initialDelay = 0,
  direction: _direction = "up",
  distance: _distance = 20,
  className = "",
}: AnimatedListProps) {
  // Items fade in place. The `direction`/`distance` props are still accepted
  // for API compatibility, but list items no longer travel across the
  // viewport: a staggered slide makes a list feel slow and shifts layout
  // while the user is already reading it.
  const getInitial = () => ({ opacity: 0 });

  const getAnimate = () => ({ opacity: 1 });

  const items = Array.isArray(children) ? children : [children];

  return (
    <div className={cn("flex flex-col", className)}>
      {items.map((child, i) => (
        <motion.div
          key={i}
          initial={getInitial()}
          animate={getAnimate()}
          transition={{
            delay: initialDelay + i * staggerDelay,
            duration: 0.12,
            ease: "linear",
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}
