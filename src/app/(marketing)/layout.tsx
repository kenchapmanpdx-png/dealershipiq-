import Link from 'next/link';
import MarketingHeader from '@/components/marketing/MarketingHeader';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain min-h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <MarketingHeader />

      {/* No spacer needed — header is invisible at top and overlays on scroll */}

      <main className="flex-1">{children}</main>

      {/* Premium footer */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-8">
            <div className="md:col-span-2">
              <p className="text-lg font-bold tracking-tight text-white mb-3">
                Dealership<span className="text-[var(--accent)]">IQ</span>
              </p>
              <p className="text-sm text-[var(--text-muted)] max-w-sm leading-relaxed">
                SMS-powered sales training that turns every rep into a closer.
                AI grades responses. Managers track results in real time.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Product</p>
              <div className="flex flex-col gap-3 text-sm text-[var(--text-muted)]">
                <a href="#features" className="hover:text-white transition-colors duration-300">Features</a>
                <a href="#how-it-works" className="hover:text-white transition-colors duration-300">How It Works</a>
                <a href="#pricing" className="hover:text-white transition-colors duration-300">Pricing</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Account</p>
              <div className="flex flex-col gap-3 text-sm text-[var(--text-muted)]">
                <Link href="/login" className="hover:text-white transition-colors duration-300">Sign In</Link>
                <Link href="/signup" className="hover:text-white transition-colors duration-300">Start Free Trial</Link>
              </div>
            </div>
          </div>
          <div className="gradient-line mt-12 mb-8" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-xs text-[var(--text-muted)]">
              &copy; 2026 DealershipIQ. All rights reserved.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Built for dealerships that take training seriously.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
