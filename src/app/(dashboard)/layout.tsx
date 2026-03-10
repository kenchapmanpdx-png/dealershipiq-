// Dashboard layout wrapper
// Server component — checks auth and renders sidebar
// Build Master: Phase 3

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const dealershipId = user.app_metadata?.dealership_id as string | undefined;
  if (!dealershipId) {
    redirect('/login');
  }

  const userRole = user.app_metadata?.user_role as string | undefined;
  if (userRole !== 'manager' && userRole !== 'owner') {
    redirect('/');
  }

  // Get user's dealership memberships for switcher
  const { data: memberships } = await supabase
    .from('dealership_memberships')
    .select(`
      dealership_id,
      dealerships ( id, name )
    `)
    .eq('user_id', user.id);

  const dealershipList = (memberships ?? [])
    .filter((m: Record<string, unknown>) => m.dealerships)
    .map((m: Record<string, unknown>) => ({
      id: m.dealership_id as string,
      name: (m.dealerships as Record<string, unknown>).name as string,
    }));

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <h1 className="text-2xl font-bold text-gray-900">DealershipIQ</h1>
              {/* Navigation links */}
              <div className="hidden md:flex gap-6">
                <NavLink href="/dashboard" label="Overview" />
                <NavLink href="/dashboard/team" label="Team" />
                <NavLink href="/dashboard/sessions" label="Sessions" />
                <NavLink href="/dashboard/coaching" label="Coaching" />
              </div>
            </div>

            {/* Dealership switcher */}
            {dealershipList.length > 1 && (
              <select
                defaultValue={dealershipId}
                onChange={(e) => {
                  // This would typically redirect or update context
                  // For now, just show intent
                  window.location.href = `/dashboard?dealership=${e.target.value}`;
                }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {dealershipList.map((d: Record<string, unknown>) => (
                  <option key={d.id as string} value={d.id as string}>
                    {d.name as string}
                  </option>
                ))}
              </select>
            )}

            {/* User menu */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {user.user_metadata?.full_name || user.email}
              </span>
              <a
                href="/api/auth/logout"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Logout
              </a>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
    >
      {label}
    </a>
  );
}
