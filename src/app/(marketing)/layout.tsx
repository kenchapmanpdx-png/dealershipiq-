// Marketing layout — light "Blue Tree" design system (2026-07-07 redesign).
// All marketing styles live in marketing.css, scoped under the .mkt wrapper
// so dashboard tokens in globals.css are untouched. Fonts load via
// next/font/google and are exposed as CSS variables the stylesheet consumes.

import Link from 'next/link';
import { Plus_Jakarta_Sans, DM_Sans } from 'next/font/google';
import MarketingNav from '@/components/marketing/MarketingNav';
import './marketing.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm',
  display: 'swap',
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt ${jakarta.variable} ${dmSans.variable}`}>
      <MarketingNav />

      <main>{children}</main>

      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <div className="footer-logo-group">
              <svg viewBox="0 0 32 32" fill="none" width="28" height="28" aria-hidden="true">
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
              <span className="footer-wordmark">DealershipIQ</span>
            </div>
            <div className="footer-links">
              <Link href="/#features">Features</Link>
              <Link href="/#how">How It Works</Link>
              <Link href="/#pricing">Pricing</Link>
              <Link href="/login">Sign In</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
            </div>
          </div>
          <div className="footer-mid">
            <div>
              <strong>DealershipIQ</strong>
              <br />
              SMS-powered sales training that turns every rep into a closer.
              <br />
              AI grades responses. Managers track results in real time.
            </div>
            <div className="footer-mid-right">
              Built for dealerships that
              <br />
              take training seriously.
            </div>
          </div>
          <div className="footer-bottom">
            <div>&copy; 2026 DealershipIQ. All rights reserved.</div>
            <div className="footer-fine">Training data stays private to your dealership.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
