// Phase 1G: Server-side Supabase client (for Server Components, Route Handlers, Server Actions)
// Uses @supabase/ssr (NOT @supabase/auth-helpers-nextjs)

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from Server Component — setAll is a no-op.
            // Middleware handles cookie refresh instead.
          }
        },
      },
    }
  );
}
