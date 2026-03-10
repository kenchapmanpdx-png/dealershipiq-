// Service-role client — bypasses ALL RLS.
// ONLY used by: crons, webhooks, and internal workers via src/lib/service-db.ts.
// NEVER import this in client-side code, dashboard routes, or server components.
// Build Master Invariant: All service-role access goes through service-db.ts.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service-role operations');
  }

  _serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return _serviceClient;
}

// Backward-compat: lazy proxy so existing `serviceClient.from(...)` calls still work
export const serviceClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getServiceClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
