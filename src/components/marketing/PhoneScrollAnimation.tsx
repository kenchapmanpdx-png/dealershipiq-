'use client';

import React, { useRef } from 'react';
import { useScroll, useTransform, motion } from 'framer-motion';

/**
 * Phone entrance + scroll animation.
 *
 * 1. On page load: phone flies in from below, tilted back, scaled down → springs to position
 * 2. On scroll down: phone tilts back slightly as you leave the hero, creating depth
 */
export default function PhoneScrollAnimation({
  children,
}: {
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Track scroll: as user scrolls down past the hero, progress goes 0 → 1
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  // Scroll-driven: subtle tilt-back as you scroll away from hero
  const scrollRotateX = useTransform(scrollYProgress, [0, 1], [0, 25]);
  const scrollScale = useTransform(scrollYProgress, [0, 1], [1, 0.85]);
  const scrollY = useTransform(scrollYProgress, [0, 1], [0, -60]);

  return (
    <div
      ref={containerRef}
      style={{ perspective: '1200px' }}
    >
      {/* Layer 1: Mount entrance — slides up from below, face-down → upright */}
      <motion.div
        initial={{
          rotateX: -60,
          scale: 0.7,
          translateY: 300,
          opacity: 0,
        }}
        animate={{
          rotateX: 0,
          scale: 1,
          translateY: 0,
          opacity: 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 42,
          damping: 16,
          mass: 1.6,
          delay: 0.3,
        }}
        style={{ transformOrigin: 'center top' }}
      >
        {/* Layer 2: Scroll-driven tilt as you leave the hero */}
        <motion.div
          style={{
            rotateX: scrollRotateX,
            scale: scrollScale,
            translateY: scrollY,
            transformOrigin: 'center bottom',
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}
