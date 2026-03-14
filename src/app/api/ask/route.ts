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

interface AskRequest {
  question: string;
}

interface AskResponse {
  id: string;
  question: string;
  response: string;
  confidence: number;
}

// L-015: Simple in-memory rate limit (MVP — replace with Upstash for production)
const askRateMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ASK_PER_HOUR = 60;

function checkAskRateLimit(userId: string): boolean {
  const now = Date.now();
  const existing = askRateMap.get(userId);
  if (!existing || existing.resetAt < now) {
    askRateMap.set(userId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  existing.count++;
  return existing.count > MAX_ASK_PER_HOUR;
}

export async function POST(request: NextRequest) {
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

    // RT-006: Feature flag gate
    const askEnabled = await isFeatureEnabled(dealershipId, 'ask_iq_enabled');
    if (!askEnabled) {
      return NextResponse.json(
        { error: 'Ask IQ is not enabled for your dealership' },
        { status: 403 }
      );
    }

    // L-015: Rate limit check
    if (checkAskRateLimit(user.id)) {
      return NextResponse.json(
        { error: 'Too many questions. Try again later.' },
        { status: 429 }
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
