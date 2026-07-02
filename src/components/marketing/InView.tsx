'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Generic in-view trigger — adds a class to its wrapper once it enters
 * the viewport, letting pure CSS (with per-child delays) run orchestrated
 * sequences. Fires once; respects prefers-reduced-motion.
 */
export default function InView({
  children,
  className = '',
  activeClassName = 'in-view',
  threshold = 0.2,
}: {
  children: React.ReactNode;
  className?: string;
  activeClassName?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={`${className} ${active ? activeClassName : ''}`.trim()}>
      {children}
    </div>
  );
}
