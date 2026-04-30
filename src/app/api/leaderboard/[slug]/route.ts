// Public Leaderboard: Dealership-specific rankings
// GET /api/leaderboard/[slug]
// No auth required — public endpoint
// Returns leaderboard for dealership identified by slug
// C-003: serviceClient justified — public endpoint, no JWT available.

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { publicDisplayName } from '@/lib/privacy';

// 2026-04-29: pin Node runtime; serviceClient construction reads env vars at
// module init and we want predictable runtime behavior on cold-start.
export const runtime = 'nodejs';

// 2026-04-18 H-7: This endpoint is unauthenticated (public TV-display
// leaderboard). We no longer return `full_name` to the internet — only the
// privacy-preserving `publicDisplayName` form ("First L."). Identity is
// still discoverable to authenticated users via the dashboard.

interface LeaderboardEntry {
  user_id: string;
  user_name: string;
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

    // D3-M-001: Bound training_results to 90 days. Public endpoint — prevents unbounded scans.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // 2026-04-29 C5a: split into two queries instead of nested embed with a
    // .gte() filter on the related table. PostgREST does not pre-filter the
    // 1:N nested rows reliably and certain shapes return ambiguous parser
    // errors → 500. Two separate queries are also faster (no big payload
    // shape to traverse) and let us aggregate cleanly in JS.

    // Query 1: active members of this dealership.
    const { data: members, error: membersError } = await serviceClient
      .from('users')
      .select(`
        id,
        full_name,
        dealership_memberships!inner (
          dealership_id
        )
      `)
      .eq('dealership_memberships.dealership_id', dealership.id)
      .eq('status', 'active')
      .limit(500);

    if (membersError) {
      console.error('Failed to fetch members:', (membersError as Error).message ?? membersError);
      return NextResponse.json(
        { error: 'Failed to fetch leaderboard' },
        { status: 500 }
      );
    }

    const memberMap = new Map<string, string>(); // user_id → full_name
    for (const m of members ?? []) {
      const mu = m as { id: string; full_name: string | null };
      memberMap.set(mu.id, mu.full_name ?? '');
    }

    // Query 2: training_results for those members, last 90 days.
    type TrainingRow = {
      user_id: string;
      product_accuracy: number;
      tone_rapport: number;
      addressed_concern: number;
      close_attempt: number;
      created_at: string;
    };

    let results: TrainingRow[] = [];
    if (memberMap.size > 0) {
      const { data: trainingResults, error: trainingError } = await serviceClient
        .from('training_results')
        .select('user_id, product_accuracy, tone_rapport, addressed_concern, close_attempt, created_at')
        .in('user_id', Array.from(memberMap.keys()))
        .gte('created_at', ninetyDaysAgo)
        .limit(10000);

      if (trainingError) {
        console.error('Failed to fetch training_results:', (trainingError as Error).message ?? trainingError);
        return NextResponse.json(
          { error: 'Failed to fetch leaderboard' },
          { status: 500 }
        );
      }
      results = (trainingResults ?? []) as TrainingRow[];
    }

    // Aggregate per user.
    const perUser = new Map<string, { sum: number; count: number; lastTs: number }>();
    for (const r of results) {
      const score = (r.product_accuracy + r.tone_rapport + r.addressed_concern + r.close_attempt) / 4;
      const ts = new Date(r.created_at).getTime();
      const acc = perUser.get(r.user_id) ?? { sum: 0, count: 0, lastTs: 0 };
      acc.sum += score;
      acc.count += 1;
      if (ts > acc.lastTs) acc.lastTs = ts;
      perUser.set(r.user_id, acc);
    }

    // Build entries for every member (zero-result users included with 0 score).
    const entries = Array.from(memberMap.entries())
      .map(([userId, fullName]) => {
        const acc = perUser.get(userId);
        const avgScore = acc && acc.count > 0 ? acc.sum / acc.count : 0;
        const lastTraining = acc && acc.lastTs > 0 ? new Date(acc.lastTs).toISOString() : null;
        return {
          user: {
            user_id: userId,
            user_name: publicDisplayName(fullName),
            total_sessions: acc?.count ?? 0,
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
    console.error('GET /api/leaderboard/[slug] error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
