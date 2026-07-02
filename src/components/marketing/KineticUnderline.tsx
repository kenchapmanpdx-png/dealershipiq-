'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Kinetic underline — gradient bar swipes in left-to-right once the
 * phrase scrolls into view. High-value copy only (playbook: dynamic
 * text treatment on key phrases, not everywhere).
 */
export default function KineticUnderline({
  children,
  delay = 450,
}: {
  children: React.ReactNode;
  delay?: number; // ms after entering viewport
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInked(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInked(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      className={`kinetic-underline ${inked ? 'is-inked' : ''}`}
      style={{ '--ink-delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </span>
  );
}
