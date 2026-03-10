import { getSubscriptionStatus } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(_request: Request) {
  try {
    // Get session
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get dealership_id from auth metadata
    const dealership_id = user.app_metadata?.dealership_id as string;
    if (!dealership_id) {
      return Response.json({ error: 'No dealership associated' }, { status: 400 });
    }

    // Get billing info from database
    const { data: dealership, error: dealershipError } = await supabase
      .from('dealerships')
      .select('stripe_customer_id, subscription_status, current_period_end, max_locations')
      .eq('id', dealership_id)
      .single();

    if (dealershipError || !dealership) {
      return Response.json({ error: 'Dealership not found' }, { status: 404 });
    }

    // Get Stripe subscription status if customer exists
    let stripeStatus = null;
    if ((dealership as Record<string, unknown>).stripe_customer_id) {
      stripeStatus = await getSubscriptionStatus((dealership as Record<string, unknown>).stripe_customer_id as string);
    }

    return Response.json({
      dealershipId: dealership_id,
      subscriptionStatus: (dealership as Record<string, unknown>).subscription_status,
      maxLocations: (dealership as Record<string, unknown>).max_locations,
      currentPeriodEnd: (dealership as Record<string, unknown>).current_period_end,
      stripe: stripeStatus,
    });
  } catch (error) {
    console.error('Status error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
