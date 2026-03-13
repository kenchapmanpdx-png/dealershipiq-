'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  value: string; // e.g. "<5s", "100%", "3x", "0"
  label: string;
}

export default function AnimatedCounter({ value, label }: AnimatedCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [displayValue, setDisplayValue] = useState('0');

  // Extract numeric part and prefix/suffix
  const match = value.match(/^([<>]?)(\d+\.?\d*)(.*)/);
  const prefix = match?.[1] ?? '';
  const numericTarget = parseFloat(match?.[2] ?? '0');
  const suffix = match?.[3] ?? '';

  const animateValue = useCallback(
    (start: number, end: number, duration: number) => {
      const startTime = performance.now();
      const isInteger = Number.isInteger(end);

      function update(currentTime: number) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (end - start) * eased;
        const formatted = isInteger ? Math.round(current).toString() : current.toFixed(1);
        setDisplayValue(`${prefix}${formatted}${suffix}`);

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          setDisplayValue(value);
        }
      }

      requestAnimationFrame(update);
    },
    [prefix, suffix, value]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setDisplayValue(value);
      setHasAnimated(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          animateValue(0, numericTarget, 1200);
          observer.unobserve(el);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimated, numericTarget, value, animateValue]);

  return (
    <div ref={ref} className="text-center">
      <p className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-1.5">
        {hasAnimated ? displayValue : <span className="opacity-0">{value}</span>}
      </p>
      <p className="text-sm text-[var(--text-muted)]">{label}</p>
    </div>
  );
}
