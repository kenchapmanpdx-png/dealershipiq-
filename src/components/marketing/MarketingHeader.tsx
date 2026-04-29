'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on scroll
  useEffect(() => {
    if (mobileOpen) {
      const close = () => setMobileOpen(false);
      window.addEventListener('scroll', close, { passive: true });
      return () => window.removeEventListener('scroll', close);
    }
  }, [mobileOpen]);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-out"
      style={{
        opacity: scrolled ? 1 : 0,
        pointerEvents: scrolled ? 'auto' : 'none',
        transform: scrolled ? 'translateY(0)' : 'translateY(-8px)',
        background: 'rgba(9, 9, 11, 0.85)',
        backdropFilter: 'blur(24px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight text-white">
          Dealership<span className="text-[var(--accent)]">IQ</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8 text-sm text-[var(--text-muted)]">
          <a href="#features" className="hover:text-white transition-colors duration-300">Features</a>
          <a href="#how-it-works" className="hover:text-white transition-colors duration-300">How It Works</a>
          <a href="#pricing" className="hover:text-white transition-colors duration-300">Pricing</a>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden sm:inline text-sm text-[var(--text-secondary)] hover:text-white transition-colors duration-300"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="hidden sm:inline text-sm font-medium bg-[var(--accent)] text-white px-5 py-2.5 rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-300 shadow-sm hover:shadow-glow"
          >
            Get Started
          </Link>

          {/* Mobile hamburger */}
          <button
            className="md:hidden relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <div className="w-5 flex flex-col gap-1.5">
              <span
                className="block h-[1.5px] bg-white rounded-full transition-all duration-300 origin-center"
                style={{
                  transform: mobileOpen ? 'rotate(45deg) translate(2.5px, 2.5px)' : 'none',
                }}
              />
              <span
                className="block h-[1.5px] bg-white rounded-full transition-all duration-300"
                style={{ opacity: mobileOpen ? 0 : 1 }}
              />
              <span
                className="block h-[1.5px] bg-white rounded-full transition-all duration-300 origin-center"
                style={{
                  transform: mobileOpen ? 'rotate(-45deg) translate(2.5px, -2.5px)' : 'none',
                }}
              />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      <div
        className="md:hidden overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: mobileOpen ? '320px' : '0px',
          opacity: mobileOpen ? 1 : 0,
        }}
      >
        <div className="px-4 pb-6 pt-2 border-t border-white/5 flex flex-col gap-1">
          <a
            href="#features"
            onClick={() => setMobileOpen(false)}
            className="text-sm text-[var(--text-secondary)] hover:text-white py-3 px-3 rounded-lg hover:bg-white/5 transition-all"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            onClick={() => setMobileOpen(false)}
            className="text-sm text-[var(--text-secondary)] hover:text-white py-3 px-3 rounded-lg hover:bg-white/5 transition-all"
          >
            How It Works
          </a>
          <a
            href="#pricing"
            onClick={() => setMobileOpen(false)}
            className="text-sm text-[var(--text-secondary)] hover:text-white py-3 px-3 rounded-lg hover:bg-white/5 transition-all"
          >
            Pricing
          </a>
          <div className="h-px bg-white/5 my-2" />
          <Link
            href="/login"
            className="text-sm text-[var(--text-secondary)] hover:text-white py-3 px-3 rounded-lg hover:bg-white/5 transition-all"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium bg-[var(--accent)] text-white text-center py-3 px-3 rounded-lg hover:bg-[var(--accent-hover)] transition-all mt-1"
          >
            Start Free Trial
          </Link>
        </div>
      </div>
    </header>
  );
}
