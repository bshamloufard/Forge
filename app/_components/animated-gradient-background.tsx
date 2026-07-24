"use client";

import { motion, useAnimationFrame, useReducedMotion } from "motion/react";
import { useMemo, useRef } from "react";
import styles from "./animated-gradient-background.module.css";

type AnimatedGradientBackgroundProps = {
  startingGap?: number;
  breathing?: boolean;
  gradientColors?: string[];
  gradientStops?: number[];
  animationSpeed?: number;
  breathingRange?: number;
  topOffset?: number;
  className?: string;
};

export function AnimatedGradientBackground({
  startingGap = 125,
  breathing = false,
  gradientColors = [
    "#080c11",
    "#121d2a",
    "#1c3042",
    "#2b465d",
    "#49465d",
    "#34504f",
    "#11171d"
  ],
  gradientStops = [27, 43, 57, 70, 82, 93, 100],
  animationSpeed = 0.00045,
  breathingRange = 5,
  topOffset = 0,
  className = ""
}: AnimatedGradientBackgroundProps) {
  const gradientRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  if (gradientColors.length !== gradientStops.length) {
    throw new Error(
      "AnimatedGradientBackground requires one stop for every gradient color."
    );
  }

  const stops = useMemo(
    () =>
      gradientStops
        .map((stop, index) => `${gradientColors[index]} ${stop}%`)
        .join(", "),
    [gradientColors, gradientStops]
  );

  useAnimationFrame((time) => {
    if (!gradientRef.current) return;

    const movement =
      breathing && !reduceMotion
        ? Math.sin(time * animationSpeed) * breathingRange
        : 0;
    const size = startingGap + movement;

    gradientRef.current.style.background = `radial-gradient(${size}% ${size + topOffset}% at 50% 18%, ${stops})`;
  });

  return (
    <motion.div
      aria-hidden="true"
      className={`${styles.container} ${className}`}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.12 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduceMotion ? 0.25 : 1.8, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div ref={gradientRef} className={styles.gradient} />
    </motion.div>
  );
}
