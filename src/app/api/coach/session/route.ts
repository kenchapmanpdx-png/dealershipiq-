// POST /api/coach/session — Start or continue a coaching session
// Phase 4.5A: Coach Mode MVP + Phase 5 (subscription gating)
// Auth: phone-based session token → user_id
// Uses GPT-4o for emotional nuance and multi-turn coaching

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled } from '@/lib/service-db';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { tokenLimitParam } from '@/lib/openai';
import { buildRepContext } from '@/lib/coach/context';
import { buildCoachSystemPrompt, DOOR_OPENING_MESSAGES, CLASSIFY_EXCHANGE_TOOL } from '@/lib/coach/prompts';
import { compactMessages, buildMessageHistory, isMaxExchanges } from '@/lib/coach/compaction';
import { verifyAppToken } from '@/app/api/app/auth/route';
import type {
  CoachDoor,
  CoachMessage,
  CoachSessionRequest,
  ExchangeClassification,
} from '@/types/coach';

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

    // Rate limit (simple in-memory counter — production would use Upstash)
    const rateLimited = await checkRateLimit(userId);
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
    console.error('Coach session error:', err);
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

    // Close stale sessions lazily
    await closeStaleSessionsForUser(userId);

    // Fetch recent sessions (last 10)
    const { data: sessions } = await serviceClient
      .from('coach_sessions')
      .select('id, session_topic, sentiment_trend, door_selected, messages, created_at, ended_at')
      .eq('user_id', userId)
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
    console.error('Coach session list error:', err);
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
    console.error('Failed to create coach session:', insertError);
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
  // Load session (verify ownership)
  const { data: session, error: fetchError } = await serviceClient
    .from('coach_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
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
      // Auto-close
      await closeSession(sessionId, messages);
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
    await closeSession(sessionId, messages);
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

    await serviceClient
      .from('coach_sessions')
      .update(updateData)
      .eq('id', sessionId);

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
  await serviceClient
    .from('coach_sessions')
    .update({ messages })
    .eq('id', sessionId);

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
      console.error('GPT-4o coach error:', res.status, await res.text());
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
    console.error('GPT-4o coach error:', err);
    return null;
  }
}

// --- Session lifecycle ---

async function closeSession(
  sessionId: string,
  messages: CoachMessage[]
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

  await serviceClient
    .from('coach_sessions')
    .update(updateData)
    .eq('id', sessionId);
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

async function closeStaleSessionsForUser(userId: string): Promise<void> {
  try {
    const staleThreshold = new Date();
    staleThreshold.setHours(staleThreshold.getHours() - SESSION_STALE_HOURS);

    // Find open sessions with no recent activity
    const { data: staleSessions } = await serviceClient
      .from('coach_sessions')
      .select('id, messages')
      .eq('user_id', userId)
      .is('ended_at', null);

    for (const session of staleSessions ?? []) {
      const msgs = (session.messages as CoachMessage[]) ?? [];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && new Date(lastMsg.timestamp) < staleThreshold) {
        await closeSession(session.id as string, msgs);
      }
    }
  } catch (err) {
    console.error('Error closing stale sessions:', err);
  }
}

// --- Auth helper ---

async function authenticateRep(
  request: NextRequest
): Promise<{ userId: string; dealershipId: string } | null> {
  // Phone-based auth: HMAC-signed session token in cookie or header
  const token =
    request.cookies.get('diq_session')?.value ??
    request.headers.get('x-diq-session') ??
    null;

  if (!token) return null;

  // Verify HMAC signature + check expiry
  const verified = verifyAppToken(token);
  if (!verified) return null;

  const { userId, dealershipId } = verified;

  // Verify user still exists in database
  try {
    const { data: user } = await serviceClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('dealership_id', dealershipId)
      .single();

    if (!user) return null;
    return { userId, dealershipId };
  } catch {
    return null;
  }
}

// --- Rate limiting (simple in-memory for MVP) ---

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

async function checkRateLimit(userId: string): Promise<boolean> {
  const now = Date.now();
  const existing = rateLimitMap.get(userId);

  if (!existing || existing.resetAt < now) {
    rateLimitMap.set(userId, {
      count: 1,
      resetAt: now + 60 * 60 * 1000,
    });
    return false;
  }

  existing.count++;
  if (existing.count > MAX_MESSAGES_PER_HOUR) return true;
  return false;
}
