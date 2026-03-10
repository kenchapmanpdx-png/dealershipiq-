// Manager Dashboard: Team members with training stats
// GET /api/dashboard/team
// Auth: manager+ role required, RLS filters by dealership_id

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dealershipId = user.app_metadata?.dealership_id as string | undefined;
    if (!dealershipId) {
      return NextResponse.json({ error: 'No dealership' }, { status: 403 });
    }

    const userRole = user.app_metadata?.user_role as string | undefined;
    if (userRole !== 'manager' && userRole !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get all users in dealership with training stats
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
      .eq('dealership_memberships.dealership_id', dealershipId);

    if (usersError) {
      console.error('Failed to fetch team members:', usersError);
      return NextResponse.json(
        { error: 'Failed to fetch team members' },
        { status: 500 }
      );
    }

    // Transform data
    const team: TeamMember[] = (users ?? []).map((user: any) => {
      const results = user.training_results ?? [];
      const avgScore = results.length > 0
        ? results.reduce((sum: number, r: any) =>
            sum + (r.product_accuracy + r.tone_rapport + r.addressed_concern + r.close_attempt) / 4,
            0
          ) / results.length
        : 0;

      const lastTraining = results.length > 0
        ? new Date(Math.max(...results.map((r: any) => new Date(r.created_at).getTime())))
            .toISOString()
        : null;

      return {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        status: user.status,
        total_sessions: results.length,
        average_score: Math.round(avgScore * 10) / 10,
        last_training_at: lastTraining,
      };
    });

    return NextResponse.json({ team });
  } catch (err) {
    console.error('GET /api/dashboard/team error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
