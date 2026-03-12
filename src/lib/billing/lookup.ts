// Phase 5: Stripe customer → dealership lookup
// Order-independent: works regardless of whether dealership or Stripe customer was created first

import { serviceClient } from '@/lib/supabase/service';

/**
 * Find dealership by stripe_customer_id.
 * Primary lookup path for webhook handlers.
 */
export async function findDealershipByStripeCustomer(
  stripeCustomerId: string
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string };
}

/**
 * Find dealership by subscription_id.
 * Fallback lookup when stripe_customer_id isn't in the event.
 */
export async function findDealershipBySubscription(
  subscriptionId: string
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string };
}
