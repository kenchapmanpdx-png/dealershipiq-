// Dashboard layout wrapper — Server component
// Auth gate: checks JWT, role, dealership. Redirects if invalid.
// CF-H-001: Nav extracted to client component (DashboardNav).
// Build Master: Phase 3, Phase 5 (billing nav + banner)

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import BillingBanner from '@/components/dashboard/BillingBanner';
import DashboardNav from '@/components/dashboard/DashboardNav';

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

  // Get current dealership name for nav display
  const { data: dealership } = await supabase
    .from('dealerships')
    .select('name')
    .eq('id', dealershipId)
    .single();

  const dealershipName = (dealership?.name as string) ?? 'My Dealership';
  const userName = (user.user_metadata?.full_name as string) || user.email || '';

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav
        dealershipName={dealershipName}
        userRole={userRole}
        userName={userName}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <BillingBanner />
        {children}
      </main>
    </div>
  );
}
