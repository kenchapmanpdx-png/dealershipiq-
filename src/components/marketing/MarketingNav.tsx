'use client';

// Fixed marketing nav: transparent over the dark hero, glass-light once
// scrolled, hides on scroll-down / reappears on scroll-up.
// NOTE: the hidden state uses class `nav-hidden` (NOT `hidden`) because
// Tailwind's global `.hidden { display: none }` would remove the nav
// entirely instead of sliding it away.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function MarketingNav() {
  const pathname = usePathname();
  // Off the landing page there's no dark hero behind the nav — force the
  // light "scrolled" treatment so white-on-white text can't happen (the
  // signup page is light).
  const isLanding = pathname === '/';

  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      setScrolled(y > 40);
      if (y > 100) {
        if (y > lastY.current && y - lastY.current > 5) setHidden(true);
        else if (lastY.current > y && lastY.current - y > 5) setHidden(false);
      } else {
        setHidden(false);
      }
      lastY.current = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const cls = `site-nav${scrolled || !isLanding ? ' scrolled' : ''}${hidden ? ' nav-hidden' : ''}`;

  return (
    <nav className={cls}>
      <Link href="/" className="nav-logo">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="6" fill="#004a8b" />
          <text
            x="16"
            y="21.5"
            textAnchor="middle"
            fontFamily="var(--font-jakarta), sans-serif"
            fontSize="13"
            fontWeight="800"
            fill="#fff"
          >
            IQ
          </text>
        </svg>
        <span className="nav-wordmark">DealershipIQ</span>
      </Link>
      <div className="nav-links">
        <Link href="/#features">Features</Link>
        <Link href="/#how">How It Works</Link>
        <Link href="/#pricing">Pricing</Link>
        <Link href="/#faq">FAQ</Link>
      </div>
      <Link href="/#signup" className="nav-cta">
        Start Free Trial
      </Link>
    </nav>
  );
}
