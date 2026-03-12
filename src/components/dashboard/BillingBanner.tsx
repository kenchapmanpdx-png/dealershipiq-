'use client';

// Phase 5: Billing status banner — computed dunning state, trial countdown
// Shows at top of dashboard when action needed.

import { useState, useEffect } from 'react';
import type { DunningStage } from '@/types/billing';

interface BillingStatus {
  subscription_status: string;
  is_pilot: boolean;
  trial_ends_at: string | null;
  days_remaining_in_trial: number | null;
  dunning_stage: DunningStage;
  is_active: boolean;
}

export default function BillingBanner() {
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/billing/status');
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Non-critical
      }
    }
    fetchStatus();
  }, []);

  if (!status) return null;
  if (status.is_pilot) return null;
  if (status.subscription_status === 'active' && status.dunning_stage === 'none') return null;

  // Trial countdown
  if (status.subscription_status === 'trialing' && status.days_remaining_in_trial !== null) {
    if (status.days_remaining_in_trial > 7) return null;

    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p className="text-sm text-blue-800">
          <span className="font-medium">Trial ending soon:</span>{' '}
          {status.days_remaining_in_trial} day{status.days_remaining_in_trial !== 1 ? 's' : ''} remaining.{' '}
          <a href="/dashboard/billing" className="underline font-medium">
            Add payment method
          </a>
        </p>
      </div>
    );
  }

  // Dunning stages
  if (status.dunning_stage !== 'none') {
    const configs: Record<string, { bg: string; border: string; text: string; message: string }> = {
      day1: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-800',
        message: 'Payment failed. Please update your payment method to keep training active.',
      },
      day3: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-800',
        message: 'Payment still pending. Update your payment method soon.',
      },
      day14: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-800',
        message: 'Payment overdue. Training access will be suspended soon.',
      },
      day21: {
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-800',
        message: 'Final notice: Subscription will be canceled in 9 days without payment.',
      },
      day30_canceled: {
        bg: 'bg-gray-50',
        border: 'border-gray-300',
        text: 'text-gray-800',
        message: 'Subscription canceled due to non-payment. Reactivate to resume training.',
      },
    };

    const config = configs[status.dunning_stage];
    if (!config) return null;

    return (
      <div className={`${config.bg} ${config.border} border rounded-lg p-3 mb-4`}>
        <p className={`text-sm ${config.text}`}>
          {config.message}{' '}
          <a href="/dashboard/billing" className="underline font-medium">
            Manage billing
          </a>
        </p>
      </div>
    );
  }

  // Canceled
  if (status.subscription_status === 'canceled') {
    return (
      <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 mb-4">
        <p className="text-sm text-gray-800">
          Subscription inactive. Training is paused.{' '}
          <a href="/dashboard/billing" className="underline font-medium">
            Reactivate
          </a>
        </p>
      </div>
    );
  }

  return null;
}
