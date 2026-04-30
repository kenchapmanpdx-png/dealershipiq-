// Ask IQ: User question endpoint
// POST /api/ask
// Body: { question: string }
// Auth: required (any authenticated user)
// Logs query, returns AI response (placeholder for now)
// C-003: Fully migrated to RLS client. askiq_insert_authenticated policy
//        added in migration 20260313100000_c003_rls_policies.sql.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/service-db';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { checkAskLimit } from '@/lib/rate-limit';
import { requireJsonContentType } from '@/lib/api-helpers';

// 2026-04-18 H-15: Rate limit ported to Upstash-backed `checkAskLimit`
// (see src/lib/rate-limit.ts). The previous in-memory Map per serverless
// instance was effectively `60/hr × N instances`, which scales with traffic
// rather than containing it. checkAskLimit is keyed on userId, shared
// across every Vercel instance, and fails CLOSED in production if Upstash
// is unreachable.

interface AskRequest {
  question: string;
}

interface AskResponse {
  id: string;
  question: string;
  response: string;
  confidence: number;
}

export async function POST(request: NextRequest) {
  try {
    // L-14: content-type gate
    const ctErr = requireJsonContentType(request);
    if (ctErr) return ctErr;

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dealershipId = user.app_metadata?.dealership_id as string | undefined;
    if (!dealershipId) {
      return NextResponse.json({ error: 'No dealership' }, { status: 403 });
    }

    // 2026-04-29 H6: Phase 5 subscription gate. Previously /api/ask only
    // checked `ask_iq_enabled` — an unpaid dealership with the flag on
    // could use Ask IQ. Now requires active subscription.
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json(
        { error: 'Subscription required', reason: subCheck.reason, status: subCheck.status },
        { status: 402 }
      );
    }

    // RT-006: Feature flag gate
    const askEnabled = await isFeatureEnabled(dealershipId, 'ask_iq_enabled');
    if (!askEnabled) {
      return NextResponse.json(
        { error: 'Ask IQ is not enabled for your dealership' },
        { status: 403 }
      );
    }

    // H-15: Upstash-backed rate limit — 60/hr/user, global across instances.
    const rl = await checkAskLimit(user.id);
    if (!rl.success) {
      const status = rl.bypass_reason === 'redis_missing' || rl.bypass_reason === 'redis_error' ? 503 : 429;
      return NextResponse.json(
        {
          error: status === 503
            ? 'Rate limiter unavailable — please try again shortly.'
            : 'Too many questions. Try again later.',
        },
        { status }
      );
    }

    const body = await request.json() as AskRequest;

    if (!body.question || body.question.trim().length === 0) {
      return NextResponse.json(
        { error: 'question is required' },
        { status: 400 }
      );
    }

    const questionText = body.question.trim();

    if (questionText.length > 1000) {
      return NextResponse.json(
        { error: 'question must be 1000 characters or less' },
        { status: 400 }
      );
    }

    // TODO: Replace stub with actual Ask IQ AI implementation (Phase 2 infrastructure).
    // F15-M-001: Set confidence=1.0 so stub responses don't pollute the knowledge_gaps
    // table and morning script. The gaps dashboard filters at confidence < 0.7.
    const aiResponse = `Thank you for your question: "${questionText}". The AI engine is being trained with your dealership's knowledge base. Check back soon for a fully personalized response!`;
    const confidence = 1.0; // Stub — high confidence prevents false knowledge gap entries

    // C-003: RLS-backed — askiq_insert_authenticated policy enforces dealership_id from JWT.
    const { data: queryRecord, error: insertError } = await supabase
      .from('askiq_queries')
      .insert({
        user_id: user.id,
        dealership_id: dealershipId,
        query_text: questionText,
        ai_response: aiResponse,
        confidence,
        topic: null, // TODO: Extract topic from question
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Failed to log query:', (insertError as Error).message ?? insertError);
      return NextResponse.json(
        { error: 'Failed to process question' },
        { status: 500 }
      );
    }

    const response: AskResponse = {
      id: queryRecord.id,
      question: questionText,
      response: aiResponse,
      confidence,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('POST /api/ask error:', (err as Error).message ?? err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
