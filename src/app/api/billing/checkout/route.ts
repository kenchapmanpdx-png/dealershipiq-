// POST /api/billing/checkout
// Phase 5: Self-service signup flow.
// 1. Create Supabase Auth user (email + password)
// 2. Create dealership row
// 3. Create dealership_membership
// 4. Set user app_metadata (dealership_id, user_role)
// 5. Redirect to Stripe Checkout with client_reference_id = dealership_id

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { createCheckoutSession } from '@/lib/stripe';
import type { CheckoutRequest } from '@/types/billing';

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutRequest = await request.json();
    const { dealershipName, email, password, managerName, locations, timezone } = body;

    if (!dealershipName || !email || !password || !managerName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const locationCount = Math.max(1, Math.min(100, locations || 1));
    const tz = timezone || 'America/New_York';

    // 1. Create Supabase Auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: managerName,
      },
    });

    if (authError) {
      if (authError.message?.includes('already') || authError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please log in instead.' },
          { status: 409 }
        );
      }
      console.error('Auth user creation failed:', authError);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    const userId = authData.user.id;

    // 2. Create dealership row
    const slug = dealershipName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50);

    const { data: dealership, error: dealershipError } = await serviceClient
      .from('dealerships')
      .insert({
        name: dealershipName,
        slug: `${slug}-${Date.now().toString(36)}`,
        timezone: tz,
        subscription_status: 'incomplete',
        max_locations: locationCount,
        settings: {},
      })
      .select('id')
      .single();

    if (dealershipError || !dealership) {
      console.error('Dealership creation failed:', dealershipError);
      await serviceClient.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: 'Failed to create dealership' }, { status: 500 });
    }

    const dealershipId = dealership.id as string;

    // 3. Create user row
    await serviceClient.from('users').insert({
      id: userId,
      email,
      full_name: managerName,
      phone: '',
      role: 'owner',
      status: 'active',
      dealership_id: dealershipId,
    });

    // 4. Create dealership_membership
    await serviceClient.from('dealership_memberships').insert({
      user_id: userId,
      dealership_id: dealershipId,
      role: 'owner',
    });

    // 5. Set user app_metadata
    await serviceClient.auth.admin.updateUserById(userId, {
      app_metadata: {
        dealership_id: dealershipId,
        user_role: 'owner',
      },
    });

    // 6. Default feature flags
    const defaultFlags = [
      { flag_name: 'morning_script_enabled', enabled: false },
      { flag_name: 'coach_mode_enabled', enabled: false },
      { flag_name: 'persona_moods_enabled', enabled: true },
      { flag_name: 'billing_enabled', enabled: true },
    ];
    for (const flag of defaultFlags) {
      await serviceClient.from('feature_flags').insert({
        dealership_id: dealershipId,
        ...flag,
        config: {},
      });
    }

    // 7. Create Stripe checkout session
    const { url } = await createCheckoutSession({
      dealershipId,
      email,
      locations: locationCount,
    });

    if (!url) {
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    return NextResponse.json({ checkoutUrl: url });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
