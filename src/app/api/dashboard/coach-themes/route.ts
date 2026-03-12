// GET /api/dashboard/coach-themes — Aggregated anonymous coaching themes
// Phase 4.5A: Coach Mode MVP
// Auth: Manager role via JWT middleware
// PRIVACY: NEVER returns individual session content, user IDs, or message text

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serviceClient } from '@/lib/supabase/service';

export async function GET(request: NextRequest) {
  // Manager auth via Supabase JWT
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  let dealershipId: string;

  try {
    // Verify JWT and extract dealership_id
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ data: null, error: 'Server config error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });
    }

    dealershipId = user.app_metadata?.dealership_id;
    const role = user.app_metadata?.user_role;

    if (!dealershipId || !['manager', 'owner'].includes(role)) {
      return NextResponse.json({ data: null, error: 'Manager access required' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ data: null, error: 'Auth failed' }, { status: 401 });
  }

  try {
    // Calculate date range (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Fetch sessions for this dealership in the period
    const { data: sessions, error: fetchError } = await serviceClient
      .from('coach_sessions')
      .select('session_topic, sentiment_trend, user_id')
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (fetchError) {
      console.error('Coach themes query error:', fetchError);
      return NextResponse.json({ data: null, error: 'Query failed' }, { status: 500 });
    }

    const allSessions = sessions ?? [];

    // Count unique users
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

    // Aggregate topics
    const topicCounts: Record<string, number> = {};
    for (const s of allSessions) {
      const topic = (s.session_topic as string) ?? 'unknown';
      topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }

    const themes = Object.entries(topicCounts)
      .map(([topic, count]) => ({
        topic,
        count,
        percentage: Math.round((count / allSessions.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    // Aggregate sentiment
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
    console.error('Coach themes error:', err);
    return NextResponse.json({ data: null, error: 'Internal error' }, { status: 500 });
  }
}
