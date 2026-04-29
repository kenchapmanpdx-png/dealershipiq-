'use client';

import { createContext, useContext } from 'react';

// 2026-04-18 C-2: Removed `token` field. The PWA session cookie is now
// HttpOnly and therefore unreadable from JavaScript. Client code relies on
// the browser automatically sending the cookie on same-origin requests to
// /api/coach/* and /api/ask — no explicit header is needed.
export interface RepSession {
  userId: string;
  dealershipId: string;
  firstName: string;
  language: string;
  authenticatedSlug?: string; // M-018: Track which slug was used for auth
}

export const SessionContext = createContext<RepSession | null>(null);

export function useRepSession() {
  return useContext(SessionContext);
}
