// PWA Layout — Employee-facing app (Ask IQ + Coach Mode)
// Auth: phone number + last 4 digits → session cookie
// Phase 4.5A: Coach Mode MVP

'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { SessionContext } from '@/lib/pwa/session-context';
import type { RepSession } from '@/lib/pwa/session-context';

export default function PWALayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<RepSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [authError, setAuthError] = useState('');
  const pathname = usePathname();
  const params = useParams();
  const slug = params.slug as string;

  useEffect(() => {
    // Check for existing session in cookie
    const existing = document.cookie
      .split('; ')
      .find((c) => c.startsWith('diq_session='));
    if (existing) {
      const token = existing.split('=')[1];
      try {
        // B-001 fix: Token is base64-encoded JSON (HMAC-signed), not colon-delimited
        const decoded = JSON.parse(atob(token));
        if (decoded.userId && decoded.dealershipId) {
          // B-002 fix: Verify token's dealershipId matches the URL slug
          // We can't do slug→dealershipId lookup client-side, but we store the slug
          // and the server-side routes validate via verifyAppToken
          setSession({
            userId: decoded.userId,
            dealershipId: decoded.dealershipId,
            firstName: decoded.firstName ?? 'there',
            language: decoded.language ?? 'en',
            token,
          });
        }
      } catch {
        // Invalid cookie — clear it
        document.cookie = 'diq_session=; path=/; max-age=0';
      }
    }
    setLoading(false);
  }, []);

  const handleAuth = useCallback(async () => {
    setAuthError('');
    if (!phone || lastFour.length !== 4) {
      setAuthError('Enter your phone number and last 4 digits');
      return;
    }

    try {
      const res = await fetch(`/api/app/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, last_four: lastFour, dealership_slug: slug }),
      });

      if (!res.ok) {
        setAuthError('Invalid credentials. Try again.');
        return;
      }

      const data = await res.json();
      const token = data.token;

      // Set cookie (24h expiry)
      document.cookie = `diq_session=${token}; path=/; max-age=86400; SameSite=Lax`;

      // B-001 fix: Token is base64-encoded JSON, not colon-delimited
      const decoded = JSON.parse(atob(token));
      setSession({
        userId: decoded.userId,
        dealershipId: decoded.dealershipId,
        firstName: decoded.firstName ?? 'there',
        language: decoded.language ?? 'en',
        token,
      });
    } catch {
      setAuthError('Connection error. Try again.');
    }
  }, [phone, lastFour, slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  // Auth screen
  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-1">DealershipIQ</h1>
          <p className="text-sm text-gray-500 mb-6">Sign in with your phone number</p>

          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 (555) 000-0000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          <label className="block text-sm font-medium text-gray-700 mb-1">Last 4 of Phone</label>
          <input
            type="text"
            value={lastFour}
            onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            maxLength={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 text-gray-900 text-center text-2xl tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          {authError && (
            <p className="text-red-600 text-sm mb-3">{authError}</p>
          )}

          <button
            onClick={handleAuth}
            className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // Check if Coach tab should be hidden (Spanish language)
  const showCoach = session.language !== 'es';

  // Determine active tab
  const isCoachActive = pathname.includes('/coach');
  const isAskActive = !isCoachActive;

  return (
    <SessionContext.Provider value={session}>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Content */}
        <main className="flex-1 overflow-auto">{children}</main>

        {/* Bottom tab bar */}
        <nav className="bg-white border-t border-gray-200 px-4 py-2 flex justify-around safe-bottom">
          <Link
            href={`/app/${slug}`}
            className={`flex flex-col items-center py-1 px-3 rounded-lg transition ${
              isAskActive
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-medium mt-0.5">Ask IQ</span>
          </Link>

          {showCoach && (
            <Link
              href={`/app/${slug}/coach`}
              className={`flex flex-col items-center py-1 px-3 rounded-lg transition ${
                isCoachActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
              <span className="text-xs font-medium mt-0.5">Coach</span>
            </Link>
          )}
        </nav>
      </div>
    </SessionContext.Provider>
  );
}
