// Shared authentication helpers for API routes
// Eliminates repeated user/role/dealership_id validation across 15+ routes
//
// 2026-04-29: Removed `requireSubscription()` and the `x-subscription-required`
// header pattern. The header was set on the response (so route handlers could
// not read it) and `requireSubscription()` was never actually called by any
// route. Dashboard routes call `checkSubscriptionAccess(dealershipId)` directly
// — that is the real subscription gate. Don't reintroduce the header pattern.

import { NextResponse } from 'next/server';
import { SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthContext {
  userId: string;
  dealershipId: string;
  userRole: string;
  user: User; // Full Supabase user object
}

/**
 * Validates user authentication and authorization in a single call.
 * Returns AuthContext on success, NextResponse (401/403) on failure.
 *
 * Usage:
 * ```
 * const auth = await requireAuth(supabase, ['manager', 'owner']);
 * if (auth instanceof NextResponse) return auth;
 * const { dealershipId, userRole } = auth;
 * ```
 *
 * @param supabase Supabase client (RLS-backed, from createServerSupabaseClient)
 * @param requiredRoles Optional array of allowed roles. If provided, user's role must be in this list.
 * @returns AuthContext on success, NextResponse(401/403) on failure
 */
export async function requireAuth(
  supabase: SupabaseClient,
  requiredRoles?: string[]
): Promise<AuthContext | NextResponse> {
  // Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Extract dealership_id from app_metadata
  const dealershipId = user.app_metadata?.dealership_id as string | undefined;
  if (!dealershipId) {
    return NextResponse.json({ error: 'No dealership' }, { status: 403 });
  }

  // Extract user_role from app_metadata
  const userRole = user.app_metadata?.user_role as string | undefined;
  if (!userRole) {
    return NextResponse.json({ error: 'No role assigned' }, { status: 403 });
  }

  // Check required roles if specified
  if (requiredRoles && !requiredRoles.includes(userRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return {
    userId: user.id,
    dealershipId,
    userRole,
    user,
  };
}

