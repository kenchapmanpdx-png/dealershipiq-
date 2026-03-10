// Service-role client — bypasses ALL RLS.
// ONLY used by: crons, webhooks, and internal workers via src/lib/service-db.ts.
// NEVER import this in client-side code, dashboard routes, or server components.
// Build Master Invariant: All service-role access goes through service-db.ts.

import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service-role operations');
}

export const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
