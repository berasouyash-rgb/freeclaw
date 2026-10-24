/**
 * MagneticButton — Interactive magnetic hover effect.
 *
 * Based on React Bits' Magnet component. When the user hovers near the button,
 * it subtly shifts toward the cursor, creating a magnetic pull effect.
 * Uses framer-motion for smooth spring physics.
 */

import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { cn } from "../../lib/utils";

interface MagneticButtonProps {
  children: ReactNode;
  onClick?: () => void;
  /** How far the button can shift (px) */
  strength?: number;
  /** Spring stiffness */
  springStiffness?: number;
  /** Spring damping */
  springDamping?: number;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}

export default function MagneticButton({
  children,
  onClick,
  strength = 30,
  springStiffness = 200,
  springDamping = 15,
  className = "",
  disabled = false,
  type = "button",
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [_isHovered, setIsHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, {
    stiffness: springStiffness,
    damping: springDamping,
  });
  const springY = useSpring(y, {
    stiffness: springStiffness,
    damping: springDamping,
  });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current || disabled) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(((e.clientX - centerX) / rect.width) * strength);
    y.set(((e.clientY - centerY) / rect.height) * strength);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      className={cn(
        "cursor-pointer transition-shadow duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </motion.button>
  );
}
