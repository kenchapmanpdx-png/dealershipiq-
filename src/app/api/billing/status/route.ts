// GET /api/billing/status
// Phase 5: Returns full billing state including pilot, trial, dunning.

import { NextResponse } from 'next/server';
import { getSubscriptionStatus } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { computeDunningStage, daysSinceUTC } from '@/lib/billing/subscription';
import type { SubscriptionStatus, BillingState } from '@/types/billing';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dealershipId = user.app_metadata?.dealership_id as string;
    if (!dealershipId) {
      return NextResponse.json({ error: 'No dealership associated' }, { status: 400 });
    }

    const { data: dealership, error: dealershipError } = await supabase
      .from('dealerships')
      .select(
        'stripe_customer_id, subscription_status, current_period_end, max_locations, is_pilot, trial_ends_at, past_due_since, subscription_id'
      )
      .eq('id', dealershipId)
      .single();

    if (dealershipError || !dealership) {
      return NextResponse.json({ error: 'Dealership not found' }, { status: 404 });
    }

    const d = dealership as Record<string, unknown>;
    const status = (d.subscription_status as SubscriptionStatus) ?? 'canceled';
    const isPilot = (d.is_pilot as boolean) ?? false;
    const trialEndsAt = d.trial_ends_at as string | null;
    const pastDueSince = d.past_due_since as string | null;

    const dunningStage = computeDunningStage(status, pastDueSince);
    let daysRemainingInTrial: number | null = null;
    if (status === 'trialing' && trialEndsAt) {
      const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
      daysRemainingInTrial = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    }

    const isActive =
      isPilot ||
      status === 'active' ||
      status === 'trialing' ||
      (status === 'past_due' && pastDueSince && daysSinceUTC(pastDueSince) <= 14);

    let stripeStatus = null;
    if (d.stripe_customer_id) {
      try {
        stripeStatus = await getSubscriptionStatus(d.stripe_customer_id as string);
      } catch {
        // Non-critical
      }
    }

    // S-012: Do not expose Stripe IDs in client-facing response
    const billingState: Omit<BillingState, 'stripe_customer_id' | 'subscription_id'> & {
      stripe_customer_id?: undefined;
      subscription_id?: undefined;
    } = {
      subscription_status: status,
      is_pilot: isPilot,
      trial_ends_at: trialEndsAt,
      current_period_end: d.current_period_end as string | null,
      past_due_since: pastDueSince,
      max_locations: (d.max_locations as number) ?? 1,
      days_remaining_in_trial: daysRemainingInTrial,
      dunning_stage: dunningStage,
      is_active: !!isActive,
    };

    return NextResponse.json({ ...billingState, stripe: stripeStatus });
  } catch (error) {
    console.error('Status error:', (error as Error).message ?? error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
