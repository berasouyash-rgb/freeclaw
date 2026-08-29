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
  direction = "up",
  distance = 20,
  className = "",
}: AnimatedListProps) {
  const getInitial = () => {
    switch (direction) {
      case "up": return { opacity: 0, y: distance };
      case "down": return { opacity: 0, y: -distance };
      case "left": return { opacity: 0, x: distance };
      case "right": return { opacity: 0, x: -distance };
    }
  };

  const getAnimate = () => {
    switch (direction) {
      case "up":
      case "down": return { opacity: 1, y: 0 };
      case "left":
      case "right": return { opacity: 1, x: 0 };
    }
  };

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
            type: "spring",
            stiffness: 300,
            damping: 24,
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}
