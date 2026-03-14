// POST /api/billing/checkout
// Phase 5: Self-service signup flow.
// C-003: serviceClient justified — signup creates new auth user + dealership before JWT exists.
//        admin.createUser, admin.updateUserById, admin.deleteUser, and initial row inserts
//        all require service_role because there is no authenticated session yet.
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
    // S-009: Reject oversized JSON payloads
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
    if (contentLength > 10_000) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    }

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
      // C-007: user_metadata used ONLY for display name (profile UI).
      // Auth decisions use app_metadata set below (line ~113). Never trust user_metadata for auth.
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
      console.error('Auth user creation failed:', (authError as Error).message ?? authError);
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
      console.error('Dealership creation failed:', (dealershipError as Error).message ?? dealershipError);
      await serviceClient.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: 'Failed to create dealership' }, { status: 500 });
    }

    const dealershipId = dealership.id as string;

    try {
      // 3. Create user row
      const { error: userError } = await serviceClient.from('users').insert({
        id: userId,
        email,
        full_name: managerName,
        phone: '',
        role: 'owner',
        status: 'active',
        dealership_id: dealershipId,
      });

      if (userError) throw userError;

      // 4. Create dealership_membership
      const { error: membershipError } = await serviceClient.from('dealership_memberships').insert({
        user_id: userId,
        dealership_id: dealershipId,
        role: 'owner',
      });

      if (membershipError) throw membershipError;

      // 5. Set user app_metadata
      const { error: metadataError } = await serviceClient.auth.admin.updateUserById(userId, {
        app_metadata: {
          dealership_id: dealershipId,
          user_role: 'owner',
        },
      });

      if (metadataError) throw metadataError;

      // 6. Default feature flags (RT-006: all features gated)
      const defaultFlags = [
        { flag_name: 'morning_script_enabled', enabled: false },
        { flag_name: 'coach_mode_enabled', enabled: false },
        { flag_name: 'persona_moods_enabled', enabled: true },
        { flag_name: 'billing_enabled', enabled: true },
        { flag_name: 'ask_iq_enabled', enabled: true },
        { flag_name: 'push_training_enabled', enabled: true },
        { flag_name: 'scenario_chains_enabled', enabled: true },
        { flag_name: 'peer_challenge_enabled', enabled: true },
        { flag_name: 'daily_challenge_enabled', enabled: true },
        { flag_name: 'manager_quick_create_enabled', enabled: true },
        { flag_name: 'behavioral_scoring_urgency', enabled: false },
        { flag_name: 'behavioral_scoring_competitive', enabled: false },
        { flag_name: 'vehicle_data_enabled', enabled: false },
      ];
      for (const flag of defaultFlags) {
        const { error: flagError } = await serviceClient.from('feature_flags').insert({
          dealership_id: dealershipId,
          ...flag,
          config: {},
        });

        if (flagError) throw flagError;
      }

      // 7. Create Stripe checkout session
      const { url } = await createCheckoutSession({
        dealershipId,
        email,
        locations: locationCount,
      });

      if (!url) {
        throw new Error('Failed to create checkout session');
      }

      return NextResponse.json({ checkoutUrl: url });
    } catch (operationError) {
      // Rollback: delete orphaned Auth user and dealership
      console.error('Signup flow failed, rolling back:', operationError);
      await serviceClient.auth.admin.deleteUser(userId);
      await serviceClient.from('dealerships').delete().eq('id', dealershipId);
      return NextResponse.json(
        { error: 'Signup failed. Please try again.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Checkout error:', (error as Error).message ?? error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
