import Stripe from 'stripe';

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

// Legacy alias
const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') return value.bind(client);
    return value;
  },
});

export async function createCheckoutSession(options: {
  dealershipName: string;
  email: string;
  locations: number;
  dealershipId?: string;
}): Promise<{ url: string | null }> {
  const pricePerLocation = 44900; // $449/month in cents
  const totalPrice = pricePerLocation * options.locations;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${options.dealershipName} - Training Platform`,
            description: `${options.locations} location(s) @ $449/month per location`,
          },
          unit_amount: totalPrice,
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/signup`,
    customer_email: options.email,
    metadata: {
      dealership_name: options.dealershipName,
      locations: options.locations.toString(),
      ...(options.dealershipId && { dealership_id: options.dealershipId }),
    },
  });

  return { url: session.url };
}

export async function createBillingPortalSession(customerId: string): Promise<{ url: string }> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard/billing`,
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
  const periodEnd = (subscription as any).current_period_end;
  const periodStart = (subscription as any).current_period_start;
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
