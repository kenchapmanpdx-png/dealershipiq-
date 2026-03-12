// Phase 5: Subscription access checks
// Two-layer gating: application (this file) + RLS (has_active_subscription function)

import { serviceClient } from '@/lib/supabase/service';
import type { SubscriptionStatus, DunningStage } from '@/types/billing';

interface SubscriptionCheck {
  allowed: boolean;
  reason: string;
  status: SubscriptionStatus;
  is_pilot: boolean;
  dunning_stage: DunningStage;
}

/**
 * Check if a dealership has an active subscription.
 * Pilots always pass. Trialing passes if trial hasn't expired.
 * Active passes. Past_due gets 14-day grace period.
 * Everything else is blocked.
 */
export async function checkSubscriptionAccess(
  dealershipId: string
): Promise<SubscriptionCheck> {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select(
      'subscription_status, is_pilot, trial_ends_at, past_due_since, current_period_end'
    )
    .eq('id', dealershipId)
    .single();

  if (error || !data) {
    return {
      allowed: false,
      reason: 'dealership_not_found',
      status: 'canceled',
      is_pilot: false,
      dunning_stage: 'none',
    };
  }

  const status = (data.subscription_status as SubscriptionStatus) ?? 'canceled';
  const isPilot = (data.is_pilot as boolean) ?? false;

  if (isPilot) {
    return {
      allowed: true,
      reason: 'pilot',
      status,
      is_pilot: true,
      dunning_stage: 'none',
    };
  }

  const dunningStage = computeDunningStage(
    status,
    data.past_due_since as string | null
  );

  switch (status) {
    case 'active':
      return { allowed: true, reason: 'active', status, is_pilot: false, dunning_stage: dunningStage };

    case 'trialing': {
      const trialEnd = data.trial_ends_at as string | null;
      if (trialEnd && new Date(trialEnd) < new Date()) {
        return { allowed: false, reason: 'trial_expired', status, is_pilot: false, dunning_stage: dunningStage };
      }
      return { allowed: true, reason: 'trialing', status, is_pilot: false, dunning_stage: dunningStage };
    }

    case 'past_due': {
      const pastDueSince = data.past_due_since as string | null;
      if (pastDueSince) {
        const daysPastDue = daysSinceUTC(pastDueSince);
        if (daysPastDue <= 14) {
          return { allowed: true, reason: 'past_due_grace', status, is_pilot: false, dunning_stage: dunningStage };
        }
      }
      return { allowed: false, reason: 'past_due_expired', status, is_pilot: false, dunning_stage: dunningStage };
    }

    default:
      return { allowed: false, reason: 'inactive', status, is_pilot: false, dunning_stage: dunningStage };
  }
}

/**
 * Compute dunning stage from subscription_status and past_due_since.
 * Computed at read time, never stored.
 */
export function computeDunningStage(
  status: SubscriptionStatus,
  pastDueSince: string | null
): DunningStage {
  if (status !== 'past_due' || !pastDueSince) return 'none';

  const days = daysSinceUTC(pastDueSince);

  if (days >= 30) return 'day30_canceled';
  if (days >= 21) return 'day21';
  if (days >= 14) return 'day14';
  if (days >= 3) return 'day3';
  return 'day1';
}

/**
 * Calculate whole days since a UTC date string.
 */
export function daysSinceUTC(dateStr: string): number {
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}
