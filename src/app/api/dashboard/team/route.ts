// Manager Dashboard: Team members with training stats
// GET /api/dashboard/team
// Auth: manager+ role required, RLS filters by dealership_id

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { requireAuth } from '@/lib/auth-helpers';
import { apiError, apiSuccess } from '@/lib/api-helpers';

interface TeamMember {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  total_sessions: number;
  average_score: number;
  last_training_at: string | null;
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // Validate auth and get context
    const auth = await requireAuth(supabase, ['manager', 'owner']);
    if (auth instanceof NextResponse) return auth;
    const { dealershipId } = auth;

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return apiError(`Subscription required: ${subCheck.reason}`, 403);
    }

    // D1-H-001: Bound training_results to 90 days to prevent unbounded growth
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        full_name,
        phone,
        status,
        dealership_memberships!inner (
          dealership_id
        ),
        training_results (
          id,
          product_accuracy,
          tone_rapport,
          addressed_concern,
          close_attempt,
          created_at
        )
      `)
      .eq('dealership_memberships.dealership_id', dealershipId)
      .gte('training_results.created_at', ninetyDaysAgo);

    if (usersError) {
      console.error('Failed to fetch team members:', (usersError as Error).message ?? usersError);
      return apiError('Failed to fetch team members', 500);
    }

    // Transform data
    const team: TeamMember[] = (users ?? []).map((user: Record<string, unknown>) => {
      const results = (user.training_results ?? []) as Array<Record<string, unknown>>;
      const avgScore = results.length > 0
        ? results.reduce((sum: number, r: Record<string, unknown>) =>
            sum + ((r.product_accuracy as number) + (r.tone_rapport as number) + (r.addressed_concern as number) + (r.close_attempt as number)) / 4,
            0
          ) / results.length
        : 0;

      const lastTraining = results.length > 0
        ? new Date(Math.max(...results.map((r: Record<string, unknown>) => new Date(r.created_at as string).getTime())))
            .toISOString()
        : null;

      return {
        id: user.id as string,
        full_name: user.full_name as string,
        phone: user.phone as string,
        status: user.status as string,
        total_sessions: results.length,
        average_score: Math.round(avgScore * 10) / 10,
        last_training_at: lastTraining,
      };
    });

    return apiSuccess({ team });
  } catch (err) {
    console.error('GET /api/dashboard/team error:', (err as Error).message ?? err);
    return apiError('Internal server error', 500);
  }
}
