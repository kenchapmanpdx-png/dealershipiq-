// Manager Dashboard: Recent training sessions with results
// GET /api/dashboard/sessions?days=7
// Auth: manager+ role required, RLS filters by dealership_id

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';

interface SessionResult {
  id: string;
  user_id: string;
  user_name: string;
  session_id: string | null;
  mode: string;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
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

    // Parse query params
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 7;

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { error: 'days must be between 1 and 365' },
        { status: 400 }
      );
    }

    // Calculate date range
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString();

    // Get training results from past N days
    const { data: results, error: resultsError } = await supabase
      .from('training_results')
      .select(`
        id,
        user_id,
        users (full_name),
        session_id,
        mode,
        product_accuracy,
        tone_rapport,
        addressed_concern,
        close_attempt,
        feedback,
        created_at
      `)
      .eq('dealership_id', dealershipId)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false });

    if (resultsError) {
      console.error('Failed to fetch sessions:', resultsError);
      return NextResponse.json(
        { error: 'Failed to fetch sessions' },
        { status: 500 }
      );
    }

    // Transform data
    const sessions: SessionResult[] = (results ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      user_id: r.user_id as string,
      user_name: ((r.users as Record<string, unknown>)?.full_name ?? 'Unknown') as string,
      session_id: r.session_id as string | null,
      mode: r.mode as string,
      product_accuracy: r.product_accuracy as number,
      tone_rapport: r.tone_rapport as number,
      addressed_concern: r.addressed_concern as number,
      close_attempt: r.close_attempt as number,
      feedback: r.feedback as string,
      created_at: r.created_at as string,
    }));

    return NextResponse.json({ sessions, days });
  } catch (err) {
    console.error('GET /api/dashboard/sessions error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
