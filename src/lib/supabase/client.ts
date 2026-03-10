// Phase 1G: Browser Supabase client
// Uses @supabase/ssr (NOT @supabase/auth-helpers-nextjs)

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
