"use client";

import { motion, useReducedMotion } from "motion/react";
import { memo, type ReactNode } from "react";

/**
 * Scroll reveal, isolated as a client leaf (taste-skill Section 3.A).
 *
 * The parent stays a Server Component and only motion crosses the boundary.
 * whileInView runs on IntersectionObserver, which is why this does not need a
 * scroll listener (Section 5.D). Under prefers-reduced-motion the wrapper
 * renders plain markup and no animation is ever scheduled.
 */
export const Reveal = memo(function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{
        duration: 0.55,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
});