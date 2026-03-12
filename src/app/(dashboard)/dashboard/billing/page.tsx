'use client';

// Phase 5: Billing management page
// Shows subscription status, manage via Stripe Customer Portal

import { useState, useEffect } from 'react';
import type { BillingState } from '@/types/billing';

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch('/api/billing/status');
        if (res.ok) {
          const data = await res.json();
          setBilling(data);
        }
      } catch {
        // Non-critical
      }
      setLoading(false);
    }
    fetchBilling();
  }, []);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    } catch {
      // Error handling
    }
    setPortalLoading(false);
  };

  if (loading) return <div className="text-gray-500">Loading billing info...</div>;
  if (!billing) return <div className="text-gray-500">Unable to load billing information.</div>;

  const statusLabels: Record<string, { label: string; color: string }> = {
    active: { label: 'Active', color: 'bg-green-100 text-green-800' },
    trialing: { label: 'Trial', color: 'bg-blue-100 text-blue-800' },
    past_due: { label: 'Past Due', color: 'bg-amber-100 text-amber-800' },
    canceled: { label: 'Canceled', color: 'bg-gray-100 text-gray-800' },
    incomplete: { label: 'Incomplete', color: 'bg-gray-100 text-gray-800' },
    unpaid: { label: 'Unpaid', color: 'bg-red-100 text-red-800' },
  };

  const statusConfig = statusLabels[billing.subscription_status] || statusLabels.canceled;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Billing</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Subscription</h2>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>

        {billing.is_pilot && (
          <p className="text-sm text-gray-600 mb-4">
            Pilot account &mdash; no billing required.
          </p>
        )}

        {billing.subscription_status === 'trialing' && billing.days_remaining_in_trial !== null && (
          <p className="text-sm text-gray-600 mb-4">
            Trial ends in {billing.days_remaining_in_trial} day{billing.days_remaining_in_trial !== 1 ? 's' : ''}.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-gray-500">Locations</span>
            <p className="font-medium text-gray-900">{billing.max_locations}</p>
          </div>
          {billing.current_period_end && (
            <div>
              <span className="text-gray-500">Current period ends</span>
              <p className="font-medium text-gray-900">
                {new Date(billing.current_period_end).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        {!billing.is_pilot && billing.stripe_customer_id && (
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 disabled:bg-gray-400 text-sm font-medium"
          >
            {portalLoading ? 'Opening...' : 'Manage Subscription'}
          </button>
        )}
      </div>
    </div>
  );
}
