// Auth route group layout — force dynamic to skip static generation
// Auth pages require Supabase env vars available only at runtime

export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
