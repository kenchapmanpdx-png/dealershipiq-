// Manager Dashboard: Knowledge gaps from low-confidence queries
// GET /api/dashboard/gaps
// Returns askiq_queries where confidence is low (< 70%)
// Auth: manager+ role required

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { requireAuth } from '@/lib/auth-helpers';
import { apiError, apiSuccess } from '@/lib/api-helpers';

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
    const auth = await requireAuth(supabase, ['manager', 'owner']);
    if (auth instanceof NextResponse) return auth;
    const { dealershipId } = auth;

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return apiError(`Subscription required: ${subCheck.reason}`, 403);
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
      return apiError('Failed to fetch knowledge gaps', 500);
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

    return apiSuccess({ gaps: transformed });
  } catch (err) {
    console.error('GET /api/dashboard/gaps error:', (err as Error).message ?? err);
    return apiError('Internal server error', 500);
  }
}
