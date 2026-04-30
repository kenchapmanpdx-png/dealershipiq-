// POST /api/coach/session — Start or continue a coaching session
// Phase 4.5A: Coach Mode MVP + Phase 5 (subscription gating)
// Auth: phone-based session token → user_id
// Uses GPT-4o for emotional nuance and multi-turn coaching
// C-003: serviceClient justified — coach_sessions has RLS with manager SELECT policy (03/13 migration).
//        Service role needed for INSERT (employee has no Supabase Auth — uses phone token via /api/app/auth).

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled } from '@/lib/service-db';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { tokenLimitParam } from '@/lib/openai';
import { buildRepContext } from '@/lib/coach/context';
import { buildCoachSystemPrompt, DOOR_OPENING_MESSAGES, CLASSIFY_EXCHANGE_TOOL } from '@/lib/coach/prompts';
import { compactMessages, buildMessageHistory, isMaxExchanges } from '@/lib/coach/compaction';
import { verifyAppToken } from '@/lib/app-auth';
import { log } from '@/lib/logger';
import type {
  CoachDoor,
  CoachMessage,
  CoachSessionRequest,
  ExchangeClassification,
} from '@/types/coach';

// 2026-04-29 H9: long-running OpenAI call (gpt-4o, ~30s) plus DB fetches plus
// a second gpt-4o-mini classify call. Vercel default is 10s on Hobby, 60s on
// Pro — we need the 60s budget to avoid 504-mid-OpenAI on slow generations.
export const maxDuration = 60;
export const runtime = 'nodejs';

const COACH_MODEL = 'gpt-4o-2024-11-20';
const CLASSIFY_MODEL = 'gpt-4o-mini-2024-07-18';
const MAX_MESSAGES_PER_HOUR = 30;
const SESSION_STALE_HOURS = 24;

export async function POST(request: NextRequest) {
  try {
    // Auth: extract user_id from phone-based session
    const authResult = await authenticateRep(request);
    if (!authResult) {
      return NextResponse.json(
        { data: null, error: 'Authentication required' },
        { status: 401 }
      );
    }
    const { userId, dealershipId } = authResult;

    // Phase 5: subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json(
        { data: null, error: 'Subscription inactive. Coach Mode unavailable.' },
        { status: 403 }
      );
    }

    // Feature flag check
    const enabled = await isFeatureEnabled(dealershipId, 'coach_mode_enabled');
    if (!enabled) {
      return NextResponse.json(
        { data: null, error: 'Coach Mode is not available for your dealership' },
        { status: 403 }
      );
    }

    // 2026-04-18 M-5: Rate limit is now per (user, dealership) pair, not global per-user.
    const rateLimited = await checkRateLimit(userId, dealershipId);
    if (rateLimited) {
      return NextResponse.json(
        { data: null, error: 'Too many messages. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    const body: CoachSessionRequest = await request.json();

    if (body.session_id) {
      return await continueSession(userId, dealershipId, body.session_id, body.message);
    } else {
      return await startNewSession(userId, dealershipId, body.door, body.message);
    }
  } catch (err) {
    console.error('Coach session error:', (err as Error).message ?? err);
    return NextResponse.json(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Also support GET for loading session history
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRep(request);
    if (!authResult) {
      return NextResponse.json({ data: null, error: 'Authentication required' }, { status: 401 });
    }

    const { userId, dealershipId } = authResult;

    const enabled = await isFeatureEnabled(dealershipId, 'coach_mode_enabled');
    if (!enabled) {
      return NextResponse.json({ data: null, error: 'Coach Mode not available' }, { status: 403 });
    }

    // F9-M-001 / 2026-04-18 M-5: Rate limit GET requests per (user, dealership).
    const rateLimited = await checkRateLimit(userId, dealershipId);
    if (rateLimited) {
      return NextResponse.json(
        { data: null, error: 'Too many requests. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    // Close stale sessions lazily (F9-H-001: scoped by dealership)
    await closeStaleSessionsForUser(userId, dealershipId);

    // C5: Scope by dealership_id so a multi-dealership user doesn't see
    // sessions from their other memberships mixed into the history.
    const { data: sessions } = await serviceClient
      .from('coach_sessions')
      .select('id, session_topic, sentiment_trend, door_selected, messages, created_at, ended_at')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .order('created_at', { ascending: false })
      .limit(10);

    const formatted = (sessions ?? []).map((s) => {
      const msgs = (s.messages as CoachMessage[]) ?? [];
      const lastCoachMsg = [...msgs].reverse().find((m) => m.role === 'assistant');
      return {
        id: s.id,
        session_topic: s.session_topic,
        sentiment_trend: s.sentiment_trend,
        door_selected: s.door_selected,
        created_at: s.created_at,
        ended_at: s.ended_at,
        preview: lastCoachMsg?.content?.slice(0, 100) ?? '',
        message_count: msgs.length,
      };
    });

    return NextResponse.json({ data: { sessions: formatted }, error: null });
  } catch (err) {
    console.error('Coach session list error:', (err as Error).message ?? err);
    return NextResponse.json({ data: null, error: 'Internal server error' }, { status: 500 });
  }
}

// --- Session handlers ---

async function startNewSession(
  userId: string,
  dealershipId: string,
  door?: CoachDoor,
  userMessage?: string
) {
  if (!door || !['tactical', 'debrief', 'career'].includes(door)) {
    return NextResponse.json(
      { data: null, error: 'Door selection required (tactical, debrief, or career)' },
      { status: 400 }
    );
  }

  // Build rep context
  const context = await buildRepContext(userId, dealershipId);

  // Create opening message
  const openingMessage: CoachMessage = {
    role: 'assistant',
    content: DOOR_OPENING_MESSAGES[door](context.first_name),
    timestamp: new Date().toISOString(),
  };

  const messages: CoachMessage[] = [openingMessage];
  const newMessages: CoachMessage[] = [openingMessage];

  // If user also sent a message, process it
  if (userMessage?.trim()) {
    const userMsg: CoachMessage = {
      role: 'user',
      content: userMessage.trim(),
      timestamp: new Date().toISOString(),
    };
    messages.push(userMsg);
    newMessages.push(userMsg);

    // Generate coach response
    const systemPrompt = buildCoachSystemPrompt(door, context);
    const coachResponse = await generateCoachResponse(
      systemPrompt,
      messages
    );

    if (coachResponse) {
      const coachMsg: CoachMessage = {
        role: 'assistant',
        content: coachResponse.content,
        timestamp: new Date().toISOString(),
      };
      messages.push(coachMsg);
      newMessages.push(coachMsg);
    }
  }

  // Insert session
  const { data: session, error: insertError } = await serviceClient
    .from('coach_sessions')
    .insert({
      user_id: userId,
      dealership_id: dealershipId,
      messages,
      door_selected: door,
      rep_context_snapshot: context,
      coaching_style: null,
      session_topic: door, // Initial topic from door
      sentiment_trend: 'neutral',
    })
    .select('id')
    .single();

  if (insertError || !session) {
    console.error('Failed to create coach session:', (insertError as Error).message ?? insertError);
    return NextResponse.json(
      { data: null, error: 'Failed to create session' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      session_id: session.id as string,
      messages: newMessages,
      session_topic: door,
    },
    error: null,
  });
}

async function continueSession(
  userId: string,
  dealershipId: string,
  sessionId: string,
  userMessage?: string
) {
  // D2-H-001: Load session (verify ownership + dealership scope)
  const { data: session, error: fetchError } = await serviceClient
    .from('coach_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .eq('dealership_id', dealershipId)
    .single();

  if (fetchError || !session) {
    return NextResponse.json(
      { data: null, error: 'Session not found' },
      { status: 404 }
    );
  }

  // Check if already closed
  if (session.ended_at) {
    return NextResponse.json({
      data: {
        session_id: sessionId,
        messages: [],
        session_topic: session.session_topic as string | null,
        session_closed: true,
      },
      error: null,
    });
  }

  const messages = (session.messages as CoachMessage[]) ?? [];

  // Check staleness
  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    const lastTime = new Date(lastMsg.timestamp).getTime();
    const hoursAgo = (Date.now() - lastTime) / (1000 * 60 * 60);
    if (hoursAgo > SESSION_STALE_HOURS) {
      // Auto-close (F9-H-001: scoped by dealership)
      await closeSession(sessionId, messages, dealershipId);
      return NextResponse.json({
        data: {
          session_id: sessionId,
          messages: [],
          session_topic: session.session_topic as string | null,
          session_closed: true,
        },
        error: null,
      });
    }
  }

  // Check exchange limit
  if (isMaxExchanges(messages)) {
    const closingMsg: CoachMessage = {
      role: 'assistant',
      content:
        "We've covered a lot. Want to start a fresh conversation, or is there one last thing?",
      timestamp: new Date().toISOString(),
    };
    messages.push(closingMsg);
    await closeSession(sessionId, messages, dealershipId);
    return NextResponse.json({
      data: {
        session_id: sessionId,
        messages: [closingMsg],
        session_topic: session.session_topic as string | null,
        session_closed: true,
      },
      error: null,
    });
  }

  if (!userMessage?.trim()) {
    return NextResponse.json(
      { data: null, error: 'Message required for continuing session' },
      { status: 400 }
    );
  }

  // Append user message
  const userMsg: CoachMessage = {
    role: 'user',
    content: userMessage.trim(),
    timestamp: new Date().toISOString(),
  };
  messages.push(userMsg);

  // Build system prompt from stored context
  const context = session.rep_context_snapshot as import('@/types/coach').RepContextSnapshot;
  const door = (session.door_selected as CoachDoor) ?? 'tactical';
  const systemPrompt = buildCoachSystemPrompt(door, context);

  // Generate response with compaction
  const coachResponse = await generateCoachResponse(systemPrompt, messages);
  const newMessages: CoachMessage[] = [userMsg];

  if (coachResponse) {
    const coachMsg: CoachMessage = {
      role: 'assistant',
      content: coachResponse.content,
      timestamp: new Date().toISOString(),
    };
    messages.push(coachMsg);
    newMessages.push(coachMsg);

    // Update session with classification
    const updateData: Record<string, unknown> = { messages };
    if (coachResponse.classification) {
      updateData.sentiment_trend = coachResponse.classification.sentiment;
      updateData.session_topic = coachResponse.classification.topic;
      if (coachResponse.classification.sentiment === 'negative' ||
          coachResponse.classification.sentiment === 'declining') {
        // Style might shift to encourager
        updateData.coaching_style = 'encourager';
      }
    }

    // D2-H-001: Scope update by dealership_id
    await serviceClient
      .from('coach_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .eq('dealership_id', dealershipId);

    return NextResponse.json({
      data: {
        session_id: sessionId,
        messages: newMessages,
        session_topic: (coachResponse.classification?.topic as string) ??
          (session.session_topic as string | null),
      },
      error: null,
    });
  }

  // GPT failed — save user message anyway
  // D2-H-001: Scope update by dealership_id
  await serviceClient
    .from('coach_sessions')
    .update({ messages })
    .eq('id', sessionId)
    .eq('dealership_id', dealershipId);

  return NextResponse.json({
    data: {
      session_id: sessionId,
      messages: [
        userMsg,
        {
          role: 'assistant' as const,
          content:
            "Something went wrong on my end. Your message is saved — try again in a moment.",
          timestamp: new Date().toISOString(),
        },
      ],
      session_topic: session.session_topic as string | null,
    },
    error: null,
  });
}

// --- GPT-4o coach response ---

interface CoachResponseResult {
  content: string;
  classification: ExchangeClassification | null;
}

async function generateCoachResponse(
  systemPrompt: string,
  messages: CoachMessage[]
): Promise<CoachResponseResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Apply compaction if needed
  const compacted = await compactMessages(messages);
  const history = buildMessageHistory(compacted, systemPrompt);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COACH_MODEL,
        messages: history,
        ...tokenLimitParam(COACH_MODEL, 500),
        temperature: 0.7,
        tools: [CLASSIFY_EXCHANGE_TOOL],
        tool_choice: 'auto',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error('GPT-4o coach error:', res.status);
      return null;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) return null;

    // Extract text content
    let content = choice.message?.content ?? '';

    // Extract classification from tool calls
    let classification: ExchangeClassification | null = null;
    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        if (tc.function?.name === 'classify_exchange') {
          try {
            classification = JSON.parse(tc.function.arguments);
          } catch {
            // Ignore parse error
          }
        }
      }
    }

    // If no text content but has tool call, generate a follow-up
    if (!content && classification) {
      content =
        "I'm having trouble thinking right now. Try again in a moment.";
    }

    return { content, classification };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('GPT-4o coach timeout');
      return {
        content:
          "I'm having trouble thinking right now. Try again in a moment.",
        classification: null,
      };
    }
    console.error('GPT-4o coach error:', (err as Error).message ?? err);
    return null;
  }
}

// --- Session lifecycle ---

async function closeSession(
  sessionId: string,
  messages: CoachMessage[],
  dealershipId?: string
): Promise<void> {
  // Classify topic via GPT-4o-mini if not already classified
  let topic: string | null = null;
  try {
    topic = await classifySessionTopic(messages);
  } catch {
    // Non-critical
  }

  const updateData: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
    messages,
  };
  if (topic) updateData.session_topic = topic;

  // F9-H-001: Scope by dealership_id to prevent cross-tenant session close
  let query = serviceClient
    .from('coach_sessions')
    .update(updateData)
    .eq('id', sessionId);

  if (dealershipId) {
    query = query.eq('dealership_id', dealershipId);
  }

  await query;
}

async function classifySessionTopic(
  messages: CoachMessage[]
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || messages.length < 2) return null;

  const summary = messages
    .slice(0, 10)
    .map((m) => `${m.role}: ${m.content.slice(0, 100)}`)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Classify this coaching conversation into ONE topic: tactical, debrief, career, emotional, compensation, conflict. Return only the topic word.',
          },
          { role: 'user', content: summary },
        ],
        ...tokenLimitParam(CLASSIFY_MODEL, 10),
        temperature: 0,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const topic = data.choices?.[0]?.message?.content?.trim().toLowerCase();
    const valid = [
      'tactical',
      'debrief',
      'career',
      'emotional',
      'compensation',
      'conflict',
    ];
    return valid.includes(topic) ? topic : null;
  } catch {
    return null;
  }
}

async function closeStaleSessionsForUser(userId: string, dealershipId: string): Promise<void> {
  // C6: dealershipId is REQUIRED. A previous optional signature let callers
  // accidentally run an unscoped close across every dealership the user belongs to.
  if (!dealershipId) {
    throw new Error('closeStaleSessionsForUser: dealershipId is required');
  }
  try {
    const staleThreshold = new Date();
    staleThreshold.setHours(staleThreshold.getHours() - SESSION_STALE_HOURS);

    const { data: staleSessions } = await serviceClient
      .from('coach_sessions')
      .select('id, messages')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .is('ended_at', null);

    for (const session of staleSessions ?? []) {
      const msgs = (session.messages as CoachMessage[]) ?? [];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && new Date(lastMsg.timestamp) < staleThreshold) {
        await closeSession(session.id as string, msgs, dealershipId);
      }
    }
  } catch (err) {
    console.error('Error closing stale sessions:', (err as Error).message ?? err);
  }
}

// --- Auth helper ---

async function authenticateRep(
  request: NextRequest
): Promise<{ userId: string; dealershipId: string } | null> {
  // 2026-04-18 C-2: HttpOnly cookie is the only source of truth — the x-diq-session
  // header fallback has been removed because:
  //   1) HttpOnly means client JS can't read the cookie to forward it as a header
  //      anyway (so the fallback was already effectively dead for browsers).
  //   2) Accepting a header-sourced token opens a session-fixation / header-
  //      injection path where a stolen token can bypass cookie protections.
  const token = request.cookies.get('diq_session')?.value ?? null;
  if (!token) return null;

  // Verify HMAC signature + check expiry
  const verified = verifyAppToken(token);
  if (!verified) return null;

  const { userId, dealershipId } = verified;

  // 2026-04-18 H-16: Re-verify the user is still active AND still a member of
  // the dealership the token was issued for. This is the server-side revocation
  // path — drop a row in users.status or memberships and access dies on the
  // next request without waiting for the 7-day token to expire.
  //
  // Fails CLOSED on any DB error: a signed token by itself must not be enough
  // to access the coach API — we need a successful membership/status check too.
  try {
    const { data: user, error: userErr } = await serviceClient
      .from('users')
      .select('status')
      .eq('id', userId)
      .maybeSingle();

    if (userErr) {
      log.error('coach.auth.user_lookup_failed', { user_id: userId, error: userErr.message });
      return null;
    }
    if (!user || user.status === 'inactive' || user.status === 'deactivated') {
      log.info('coach.auth.inactive_user_rejected', { user_id: userId });
      return null;
    }

    const { data: membership, error: memErr } = await serviceClient
      .from('dealership_memberships')
      .select('user_id')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .maybeSingle();

    if (memErr) {
      log.error('coach.auth.membership_lookup_failed', {
        user_id: userId,
        dealership_id: dealershipId,
        error: memErr.message,
      });
      return null;
    }
    if (!membership) {
      log.info('coach.auth.membership_revoked', {
        user_id: userId,
        dealership_id: dealershipId,
      });
      return null;
    }

    return { userId, dealershipId };
  } catch (err) {
    log.error('coach.auth.db_error', {
      user_id: userId,
      dealership_id: dealershipId,
      error: (err as Error).message ?? String(err),
    });
    return null;
  }
}

// --- Rate limiting (DB-backed via coach_sessions) ---
// M-003: Replaced in-memory Map with DB query. Counts user messages across
// all coach sessions in the last hour. Shared across Vercel instances, survives cold starts.
//
// 2026-04-18 M-5: Rate limit is now scoped by (user_id, dealership_id). A user
// who belongs to multiple dealerships gets MAX_MESSAGES_PER_HOUR per
// dealership, not a single global pool. This matches the isolation model for
// sessions and prevents one dealership's traffic from starving another's.
//
// 2026-04-18 H-12: Fails CLOSED in production on DB error. Previously failed
// open (returned false → allowed request). Opening the rate limiter on DB
// error is safer for uptime but opens an abuse window where an attacker who
// can intermittently degrade the DB gets unlimited LLM calls. In prod we'd
// rather 500 than allow unbounded spend; in dev we keep fail-open so local
// DB flakiness doesn't block work.
async function checkRateLimit(
  userId: string,
  dealershipId: string
): Promise<boolean> {
  const failClosed = process.env.NODE_ENV === 'production';
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: sessions, error } = await serviceClient
      .from('coach_sessions')
      .select('id, messages')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .gte('created_at', oneHourAgo);

    if (error) {
      log.error('coach.rate_limit.db_error', {
        user_id: userId,
        dealership_id: dealershipId,
        error: error.message,
        fail_mode: failClosed ? 'closed' : 'open',
      });
      return failClosed; // true = treat as rate-limited (deny)
    }

    let userMessageCount = 0;
    for (const s of sessions ?? []) {
      const msgs = (s.messages as Array<{ role: string }>) ?? [];
      userMessageCount += msgs.filter((m) => m.role === 'user').length;
    }

    return userMessageCount >= MAX_MESSAGES_PER_HOUR;
  } catch (err) {
    log.error('coach.rate_limit.exception', {
      user_id: userId,
      dealership_id: dealershipId,
      error: (err as Error).message ?? String(err),
      fail_mode: failClosed ? 'closed' : 'open',
    });
    return failClosed;
  }
}
