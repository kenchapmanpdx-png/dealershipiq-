// GET /api/dashboard/coach-themes — Aggregated anonymous coaching themes
// Phase 4.5A: Coach Mode MVP
// Auth: Manager role via Supabase JWT (cookie-based)
// PRIVACY: NEVER returns individual session content, user IDs, or message text
// C-003: Auth migrated to createServerSupabaseClient.
//        coach_sessions query stays on serviceClient — table has deny-all RLS
//        (no authenticated SELECT policy). Add policy in future migration.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const dealershipId = user.app_metadata?.dealership_id as string | undefined;
    const role = user.app_metadata?.user_role as string | undefined;

    if (!dealershipId || !role || !['manager', 'owner'].includes(role)) {
      return NextResponse.json({ data: null, error: 'Manager access required' }, { status: 403 });
    }

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json({ data: null, error: 'Subscription required' }, { status: 403 });
    }

    // Calculate date range (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // C-003 NOTE: coach_sessions has deny-all RLS — must use serviceClient.
    // TODO: Add authenticated SELECT policy on coach_sessions in future migration.
    const { data: sessions, error: fetchError } = await serviceClient
      .from('coach_sessions')
      .select('session_topic, sentiment_trend, user_id')
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (fetchError) {
      console.error('Coach themes query error:', (fetchError as Error).message ?? fetchError);
      return NextResponse.json({ data: null, error: 'Query failed' }, { status: 500 });
    }

    const allSessions = sessions ?? [];

    // Count unique users (internal use only, never exposed)
    const uniqueUsers = new Set(allSessions.map((s) => s.user_id as string)).size;

    // Privacy check: need >= 3 unique users
    if (uniqueUsers < 3) {
      return NextResponse.json({
        data: {
          period: 'last_7_days',
          total_sessions: allSessions.length,
          unique_users: uniqueUsers,
          themes: [],
          sentiment_distribution: { positive: 0, neutral: 0, negative: 0, declining: 0 },
          insufficient_data: true,
          message: 'Need at least 3 team members using Coach Mode to show themes.',
        },
        error: null,
      });
    }

    // Aggregate topics (never expose user_id)
    const topicCounts: Record<string, number> = {};
    for (const s of allSessions) {
      const topic = (s.session_topic as string) ?? 'unknown';
      topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }

    const themes = Object.entries(topicCounts)
      .map(([topic, count]) => ({
        topic,
        count,
        // V4-H-001: Guard division by zero when no sessions
        percentage: allSessions.length > 0 ? Math.round((count / allSessions.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Aggregate sentiment (never expose user_id)
    const sentimentDist = { positive: 0, neutral: 0, negative: 0, declining: 0 };
    for (const s of allSessions) {
      const sentiment = (s.sentiment_trend as string) ?? 'neutral';
      if (sentiment in sentimentDist) {
        sentimentDist[sentiment as keyof typeof sentimentDist]++;
      }
    }

    return NextResponse.json({
      data: {
        period: 'last_7_days',
        total_sessions: allSessions.length,
        unique_users: uniqueUsers,
        themes,
        sentiment_distribution: sentimentDist,
      },
      error: null,
    });
  } catch (err) {
    console.error('Coach themes error:', (err as Error).message ?? err);
    return NextResponse.json({ data: null, error: 'Internal error' }, { status: 500 });
  }
}
