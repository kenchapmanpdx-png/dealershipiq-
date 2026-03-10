import { verifyWebhookSignature, Stripe } from '@/lib/stripe';
import {
  updateDealershipBilling,
  getDealershipByStripeCustomer,
  createDealershipWithManager,
} from '@/lib/service-db';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    ) as unknown as Stripe.Event;
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return Response.json({ error: 'Webhook signature verification failed' }, { status: 401 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const customerId = session.customer as string;
  const dealershipName = (session.metadata?.dealership_name as string) || 'Dealership';
  const email = session.customer_email || '';
  const locationsStr = (session.metadata?.locations as string) || '1';
  const locations = parseInt(locationsStr, 10) || 1;

  // Create dealership with manager account
  const phone = email.split('@')[0]; // Temporary phone placeholder
  const { dealershipId } = await createDealershipWithManager(
    {
      name: dealershipName,
      timezone: 'America/New_York', // Default, will be updated during onboarding
      stripeCustomerId: customerId,
    },
    {
      email,
      fullName: dealershipName.split(' ')[0] || 'Manager',
      phone,
    }
  );

  // Update billing info
  await updateDealershipBilling(dealershipId, {
    stripeCustomerId: customerId,
    subscriptionStatus: 'active',
    maxLocations: locations,
  });
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const dealership = await getDealershipByStripeCustomer(customerId);
  if (!dealership) return;

  const locations = subscription.items.data[0]?.quantity || 1;
  const periodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number;
  const currentPeriodEnd = new Date(periodEnd * 1000).toISOString();

  await updateDealershipBilling(dealership.id, {
    subscriptionStatus: 'active',
    subscriptionId: subscription.id,
    maxLocations: locations,
    currentPeriodEnd,
    pastDueSince: null,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const dealership = await getDealershipByStripeCustomer(customerId);
  if (!dealership) return;

  const locations = subscription.items.data[0]?.quantity || 1;
  const periodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number;
  const currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
  const subscriptionStatus = subscription.status;

  if (subscriptionStatus === 'past_due' && !dealership.id) {
    return; // Avoid null reference
  }

  await updateDealershipBilling(dealership.id, {
    subscriptionStatus,
    subscriptionId: subscription.id,
    maxLocations: locations,
    currentPeriodEnd,
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const dealership = await getDealershipByStripeCustomer(customerId);
  if (!dealership) return;

  await updateDealershipBilling(dealership.id, {
    subscriptionStatus: 'canceled',
  });
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const dealership = await getDealershipByStripeCustomer(customerId);
  if (!dealership) return;

  // Clear past_due flag
  await updateDealershipBilling(dealership.id, {
    subscriptionStatus: 'active',
    pastDueSince: null,
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const dealership = await getDealershipByStripeCustomer(customerId);
  if (!dealership) return;

  const now = new Date().toISOString();
  await updateDealershipBilling(dealership.id, {
    subscriptionStatus: 'past_due',
    pastDueSince: now,
  });
}
