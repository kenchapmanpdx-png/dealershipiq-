'use client';

import { createContext, useContext } from 'react';

export interface RepSession {
  userId: string;
  dealershipId: string;
  firstName: string;
  language: string;
  token: string;
  authenticatedSlug?: string; // M-018: Track which slug was used for auth
}

export const SessionContext = createContext<RepSession | null>(null);

export function useRepSession() {
  return useContext(SessionContext);
}
