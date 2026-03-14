// Phase 5: Stripe client — lazy singleton + Proxy pattern
// Uses STRIPE_PRICE_ID env var instead of hardcoded price.
// Supports 30-day trial, client_reference_id for webhook correlation.

import Stripe from 'stripe';

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

// Proxy defers initialization until first property access (env vars unavailable at build time)
const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') return value.bind(client);
    return value;
  },
});

export async function createCheckoutSession(options: {
  dealershipId: string;
  email: string;
  locations: number;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ url: string | null }> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID must be set');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealershipiq-wua7.vercel.app';

  // RT-009: Idempotency key prevents duplicate checkout sessions from double-submit.
  // Stripe deduplicates requests with matching keys within 24 hours.
  const idempotencyKey = `checkout_${options.dealershipId}_${options.email}`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: options.locations,
      },
    ],
    mode: 'subscription',
    subscription_data: {
      trial_period_days: 30,
      metadata: {
        dealership_id: options.dealershipId,
      },
    },
    client_reference_id: options.dealershipId,
    customer_email: options.email,
    success_url: options.successUrl || `${appUrl}/dashboard/onboarding?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: options.cancelUrl || `${appUrl}/signup`,
    metadata: {
      dealership_id: options.dealershipId,
      locations: options.locations.toString(),
    },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
  }, {
    idempotencyKey,
  });

  return { url: session.url };
}

export async function createBillingPortalSession(customerId: string): Promise<{ url: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealershipiq-wua7.vercel.app';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  });
  return { url: session.url };
}

export async function getSubscriptionStatus(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    limit: 1,
  });

  if (!subscriptions.data.length) return null;

  const subscription = subscriptions.data[0];
  const periodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number;
  const periodStart = (subscription as unknown as Record<string, unknown>).current_period_start as number;
  const trialEnd = (subscription as unknown as Record<string, unknown>).trial_end as number | null;

  return {
    id: subscription.id,
    status: subscription.status as
      | 'active'
      | 'past_due'
      | 'unpaid'
      | 'canceled'
      | 'incomplete'
      | 'incomplete_expired'
      | 'trialing',
    currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
    currentPeriodStart: new Date(periodStart * 1000).toISOString(),
    trialEnd: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
    items: subscription.items.data.map((item) => ({
      id: item.id,
      quantity: item.quantity || 1,
    })),
  };
}

export async function getCustomer(customerId: string) {
  return stripe.customers.retrieve(customerId);
}

export function verifyWebhookSignature(
  body: string | Buffer,
  signature: string,
  secret: string
) {
  return stripe.webhooks.constructEvent(body, signature, secret);
}

export { Stripe };
