// Public Leaderboard: Dealership-specific rankings
// GET /api/leaderboard/[slug]
// No auth required — public endpoint
// Returns leaderboard for dealership identified by slug

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';

interface LeaderboardEntry {
  user_id: string;
  user_name: string;
  phone: string;
  total_sessions: number;
  average_score: number;
  last_training_at: string | null;
  rank: number;
}

interface LeaderboardResponse {
  dealership: {
    name: string;
    slug: string;
  };
  leaderboard: LeaderboardEntry[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug || slug.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid slug' },
        { status: 400 }
      );
    }

    // Get dealership by slug
    const { data: dealership, error: dealershipError } = await serviceClient
      .from('dealerships')
      .select('id, name, slug')
      .eq('slug', slug)
      .maybeSingle();

    if (dealershipError && dealershipError.code !== 'PGRST116') {
      throw dealershipError;
    }

    if (!dealership) {
      return NextResponse.json(
        { error: 'Dealership not found' },
        { status: 404 }
      );
    }

    // Get all users in dealership with training stats
    const { data: users, error: usersError } = await serviceClient
      .from('users')
      .select(`
        id,
        full_name,
        phone,
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
      .eq('dealership_memberships.dealership_id', dealership.id)
      .eq('status', 'active');

    if (usersError) {
      console.error('Failed to fetch users:', usersError);
      return NextResponse.json(
        { error: 'Failed to fetch leaderboard' },
        { status: 500 }
      );
    }

    // Calculate scores and sort
    const entries: Array<{ user: Record<string, unknown>; score: number }> = (users ?? [])
      .map((user: Record<string, unknown>) => {
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
          user: {
            user_id: user.id as string,
            user_name: user.full_name as string,
            phone: user.phone as string,
            total_sessions: results.length,
            average_score: Math.round(avgScore * 10) / 10,
            last_training_at: lastTraining,
          },
          score: avgScore,
        };
      })
      .sort((a, b) => b.score - a.score); // Descending

    // Assign ranks
    const leaderboard: LeaderboardEntry[] = entries.map((entry, index) => {
      const user = entry.user as Record<string, unknown>;
      return {
        user_id: user.user_id as string,
        user_name: user.user_name as string,
        phone: user.phone as string,
        total_sessions: user.total_sessions as number,
        average_score: user.average_score as number,
        last_training_at: user.last_training_at as string | null,
        rank: index + 1,
      };
    });

    const response: LeaderboardResponse = {
      dealership: {
        name: dealership.name,
        slug: dealership.slug,
      },
      leaderboard,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('GET /api/leaderboard/[slug] error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
