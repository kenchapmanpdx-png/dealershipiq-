// CF-H-001 + D1-M-001 + D1-M-002: Client component for dashboard navigation.
// Extracted from server layout to fix: window reference in server component,
// dead dealership switcher, and onChange handler in SSR context.
// Switcher removed until proper dealership switching is implemented.

'use client';

interface DashboardNavProps {
  dealershipName: string;
  userRole: string;
  userName: string;
}

export default function DashboardNav({
  dealershipName,
  userRole,
  userName,
}: DashboardNavProps) {
  return (
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
              <NavLink href="/dashboard/gaps" label="Knowledge Gaps" />
              {userRole === 'owner' && (
                <NavLink href="/dashboard/billing" label="Billing" />
              )}
            </div>
          </div>

          {/* Dealership name + user menu */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700">
              {dealershipName}
            </span>
            <span className="text-sm text-gray-600">{userName}</span>
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
