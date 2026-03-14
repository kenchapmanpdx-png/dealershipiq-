// Manager Dashboard: Sessions flagged for coaching
// GET /api/dashboard/coaching-queue
// Returns sessions where: score < 3 in any dimension OR perfect 5/5/5/5
// Auth: manager+ role required

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';

interface CoachingSession {
  id: string;
  user_id: string;
  user_name: string;
  mode: string;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  reason: 'low_score' | 'perfect_score';
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

    // Get all training results from past 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffIso = cutoff.toISOString();

    const { data: results, error: resultsError } = await supabase
      .from('training_results')
      .select(`
        id,
        user_id,
        users (full_name),
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
      console.error('Failed to fetch coaching queue:', (resultsError as Error).message ?? resultsError);
      return NextResponse.json(
        { error: 'Failed to fetch coaching queue' },
        { status: 500 }
      );
    }

    // Filter for coaching candidates
    const coachingQueue: CoachingSession[] = (results ?? []).reduce(
      (acc: CoachingSession[], r: Record<string, unknown>) => {
        const scores = [
          r.product_accuracy as number,
          r.tone_rapport as number,
          r.addressed_concern as number,
          r.close_attempt as number,
        ];

        // Low score: any dimension < 3
        const hasLowScore = scores.some((s) => s < 3);
        // Perfect score: all dimensions = 5
        const isPerfect = scores.every((s) => s === 5);

        if (hasLowScore || isPerfect) {
          acc.push({
            id: r.id as string,
            user_id: r.user_id as string,
            user_name: ((r.users as Record<string, unknown>)?.full_name ?? 'Unknown') as string,
            mode: r.mode as string,
            product_accuracy: r.product_accuracy as number,
            tone_rapport: r.tone_rapport as number,
            addressed_concern: r.addressed_concern as number,
            close_attempt: r.close_attempt as number,
            feedback: r.feedback as string,
            reason: hasLowScore ? 'low_score' : 'perfect_score',
            created_at: r.created_at as string,
          });
        }

        return acc;
      },
      []
    );

    return NextResponse.json({ queue: coachingQueue });
  } catch (err) {
    console.error('GET /api/dashboard/coaching-queue error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
