// Manager Dashboard: Knowledge gaps from low-confidence queries
// GET /api/dashboard/gaps
// Returns askiq_queries where confidence is low (< 70%)
// Auth: manager+ role required

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';

interface KnowledgeGap {
  id: string;
  user_id: string;
  user_name: string;
  query_text: string;
  ai_response: string;
  confidence: number;
  topic: string | null;
  created_at: string;
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

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json({ error: 'Subscription required', reason: subCheck.reason }, { status: 403 });
    }

    // Get low-confidence queries from past 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString();

    const { data: gaps, error: gapsError } = await supabase
      .from('askiq_queries')
      .select(`
        id,
        user_id,
        users (full_name),
        query_text,
        ai_response,
        confidence,
        topic,
        created_at
      `)
      .eq('dealership_id', dealershipId)
      .lt('confidence', 0.7)
      .gte('created_at', cutoffIso)
      .order('confidence', { ascending: true })
      .limit(100);

    if (gapsError) {
      console.error('Failed to fetch knowledge gaps:', (gapsError as Error).message ?? gapsError);
      return NextResponse.json(
        { error: 'Failed to fetch knowledge gaps' },
        { status: 500 }
      );
    }

    // Transform data
    const transformed: KnowledgeGap[] = (gaps ?? []).map((g: Record<string, unknown>) => ({
      id: g.id as string,
      user_id: g.user_id as string,
      user_name: ((g.users as Record<string, unknown>)?.full_name ?? 'Unknown') as string,
      query_text: g.query_text as string,
      ai_response: g.ai_response as string,
      confidence: Math.round((g.confidence as number) * 100),
      topic: g.topic as string | null,
      created_at: g.created_at as string,
    }));

    return NextResponse.json({ gaps: transformed });
  } catch (err) {
    console.error('GET /api/dashboard/gaps error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
