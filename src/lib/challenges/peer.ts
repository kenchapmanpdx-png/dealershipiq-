// Phase 6D: Peer Challenge Mode
// CHALLENGE [name] → match → same scenario → grade both → results to both
// 4-hour expiry, no-show = default win

import { serviceClient } from '@/lib/supabase/service';
import { tokenLimitParam } from '@/lib/openai';
import { selectTrainingDomain } from '@/lib/adaptive-weighting';
import type { DisambiguationOption, GradingRubric } from '@/types/challenges';

/**
 * Parse CHALLENGE keyword from message.
 * Only triggers if message is 40 chars or fewer and starts with "CHALLENGE ".
 */
export function parseChallengeKeyword(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > 40) return null;
  const match = trimmed.match(/^challenge\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Find user(s) matching a name at a dealership.
 */
export async function findChallengeTarget(
  name: string,
  dealershipId: string,
  excludeUserId: string
): Promise<{ users: Array<{ id: string; fullName: string }> }> {
  const { data } = await serviceClient
    .from('users')
    .select('id, full_name')
    .eq('dealership_id', dealershipId)
    .eq('status', 'active')
    .neq('id', excludeUserId)
    .ilike('full_name', `${name}%`);

  return {
    users: (data ?? []).map(u => ({
      id: u.id as string,
      fullName: u.full_name as string,
    })),
  };
}

/**
 * Check availability of a challenge target.
 * Returns null if available, or an error message if not.
 */
export async function checkChallengeAvailability(
  challengedId: string,
  challengerId: string,
  dealershipId: string
): Promise<string | null> {
  // Check: self-challenge not allowed
  if (challengerId === challengedId) {
    return 'You cannot challenge yourself.';
  }

  // Check: challenged already in active challenge
  const { data: existingChallenge } = await serviceClient
    .from('peer_challenges')
    .select('id')
    .or(`challenger_id.eq.${challengedId},challenged_id.eq.${challengedId}`)
    .in('status', ['pending', 'active'])
    .limit(1)
    .maybeSingle();

  if (existingChallenge) {
    return 'already has a challenge going';
  }

  // Check: challenger already in active challenge
  const { data: challengerActive } = await serviceClient
    .from('peer_challenges')
    .select('id')
    .or(`challenger_id.eq.${challengerId},challenged_id.eq.${challengerId}`)
    .in('status', ['pending', 'active'])
    .limit(1)
    .maybeSingle();

  if (challengerActive) {
    return 'You already have a challenge going. Finish it first.';
  }

  // Check: is today a daily challenge day for this dealership?
  const { isFeatureEnabled, getFeatureFlagConfig } = await import('@/lib/service-db');
  const dailyEnabled = await isFeatureEnabled(dealershipId, 'daily_challenge_enabled');
  if (dailyEnabled) {
    const config = await getFeatureFlagConfig(dealershipId, 'daily_challenge_enabled');
    const freq = (config?.frequency as string) ?? 'mwf';
    if (isChallengeDay(freq)) {
      return 'Today is a team challenge day. Try peer challenge tomorrow.';
    }
  }

  return null;
}

/**
 * Create a peer challenge in pending state.
 */
export async function createPeerChallenge(
  challengerId: string,
  challengedId: string,
  dealershipId: string
): Promise<string> {
  const expiresAt = new Date(Date.now() + 4 * 60 * 60_000); // 4 hours

  const { data, error } = await serviceClient
    .from('peer_challenges')
    .insert({
      dealership_id: dealershipId,
      challenger_id: challengerId,
      challenged_id: challengedId,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Create a disambiguation challenge.
 */
export async function createDisambiguationChallenge(
  challengerId: string,
  dealershipId: string,
  options: DisambiguationOption[]
): Promise<string> {
  const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 min

  const { data, error } = await serviceClient
    .from('peer_challenges')
    .insert({
      dealership_id: dealershipId,
      challenger_id: challengerId,
      status: 'disambiguating',
      disambiguation_options: options,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Check if user has a pending disambiguation.
 */
export async function getPendingDisambiguation(
  userId: string
): Promise<{ id: string; options: DisambiguationOption[] } | null> {
  const { data } = await serviceClient
    .from('peer_challenges')
    .select('id, disambiguation_options')
    .eq('challenger_id', userId)
    .eq('status', 'disambiguating')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!data || !data.disambiguation_options) return null;
  return {
    id: data.id as string,
    options: data.disambiguation_options as DisambiguationOption[],
  };
}

/**
 * Resolve disambiguation — update challenge with selected user.
 */
export async function resolveDisambiguation(
  challengeId: string,
  challengedId: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 4 * 60 * 60_000);
  await serviceClient
    .from('peer_challenges')
    .update({
      challenged_id: challengedId,
      status: 'pending',
      disambiguation_options: null,
      expires_at: expiresAt.toISOString(),
    })
    .eq('id', challengeId);
}

/**
 * Check if user has a pending challenge (they are the challenged party).
 */
export async function getPendingChallengeForUser(
  userId: string
): Promise<{ id: string; challengerId: string } | null> {
  const { data } = await serviceClient
    .from('peer_challenges')
    .select('id, challenger_id')
    .eq('challenged_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id as string, challengerId: data.challenger_id as string };
}

/**
 * Accept a peer challenge — generate scenario + activate.
 */
export async function acceptChallenge(
  challengeId: string,
  challengerId: string,
  challengedId: string,
  dealershipId: string
): Promise<{ scenarioText: string; taxonomyDomain: string }> {
  // Use challenger's weakest domain
  let domain = 'objection_handling';
  try {
    domain = await selectTrainingDomain(challengerId, dealershipId) ?? 'objection_handling';
  } catch {
    // Fallback
  }

  // Generate shared scenario
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const model = 'gpt-5.4-2026-03-05';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let scenarioText = 'A customer walks in interested in a vehicle. They have concerns about the price. Help them see the value.';
  let rubric: GradingRubric = {
    product_accuracy: 'accuracy of product knowledge',
    tone_rapport: 'warmth and rapport building',
    concern_addressed: 'directly addressing customer concern',
    close_attempt: 'natural next step to advance the sale',
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `Generate a head-to-head challenge scenario for automotive salespeople. Domain: ${domain.replace(/_/g, ' ')}.
Output JSON: { "scenario_text": "under 300 chars, customer-facing", "grading_rubric": { "product_accuracy": "...", "tone_rapport": "...", "concern_addressed": "...", "close_attempt": "..." } }`,
          },
          { role: 'user', content: `Generate a peer challenge scenario for ${domain.replace(/_/g, ' ')}.` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'peer_scenario',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                scenario_text: { type: 'string' },
                grading_rubric: {
                  type: 'object',
                  properties: {
                    product_accuracy: { type: 'string' },
                    tone_rapport: { type: 'string' },
                    concern_addressed: { type: 'string' },
                    close_attempt: { type: 'string' },
                  },
                  required: ['product_accuracy', 'tone_rapport', 'concern_addressed', 'close_attempt'],
                  additionalProperties: false,
                },
              },
              required: ['scenario_text', 'grading_rubric'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.8,
        ...tokenLimitParam(model, 500),
      }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = await res.json();
      const content = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
      if (content.scenario_text) scenarioText = content.scenario_text;
      if (content.grading_rubric) rubric = content.grading_rubric;
    }
  } catch {
    // Use fallback
  } finally {
    clearTimeout(timeout);
  }

  // Update challenge
  await serviceClient
    .from('peer_challenges')
    .update({
      status: 'active',
      scenario_text: scenarioText,
      grading_rubric: rubric,
      taxonomy_domain: domain,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', challengeId);

  return { scenarioText, taxonomyDomain: domain };
}

/**
 * Decline a peer challenge.
 */
export async function declineChallenge(challengeId: string): Promise<void> {
  await serviceClient
    .from('peer_challenges')
    .update({ status: 'declined' })
    .eq('id', challengeId);
}

/**
 * Check if both participants have completed their sessions.
 * If so, determine winner and send results.
 * Uses atomic update to prevent race condition: only the first caller succeeds.
 */
export async function checkAndCompleteChallenge(
  challengeId: string
): Promise<{
  complete: boolean;
  challengerScore: number | null;
  challengedScore: number | null;
  winnerId: string | null;
  challengerDimensions?: Record<string, number>;
  challengedDimensions?: Record<string, number>;
} | null> {
  // First, read challenge and check both sessions completed
  const { data: challenge } = await serviceClient
    .from('peer_challenges')
    .select('challenger_session_id, challenged_session_id, challenger_id, challenged_id, status')
    .eq('id', challengeId)
    .single();

  if (!challenge) return null;

  // If already completed, return null (already handled)
  if (challenge.status !== 'active') return null;

  // Check both sessions completed
  const sessionIds = [challenge.challenger_session_id, challenge.challenged_session_id].filter(Boolean) as string[];
  if (sessionIds.length < 2) return { complete: false, challengerScore: null, challengedScore: null, winnerId: null };

  const { data: sessions } = await serviceClient
    .from('conversation_sessions')
    .select('id, status')
    .in('id', sessionIds);

  const allComplete = (sessions ?? []).every(s => s.status === 'completed');
  if (!allComplete) return { complete: false, challengerScore: null, challengedScore: null, winnerId: null };

  // Get scores and dimension breakdowns for both
  const scores: Record<string, number> = {};
  const dimensionScores: Record<string, Record<string, number>> = {};
  for (const sid of sessionIds) {
    const { data: result } = await serviceClient
      .from('training_results')
      .select('product_accuracy, tone_rapport, addressed_concern, close_attempt')
      .eq('session_id', sid)
      .limit(1)
      .maybeSingle();

    if (result) {
      const dims = {
        product_accuracy: result.product_accuracy as number,
        tone_rapport: result.tone_rapport as number,
        addressed_concern: result.addressed_concern as number,
        close_attempt: result.close_attempt as number,
      };
      dimensionScores[sid] = dims;
      const avg = (dims.product_accuracy + dims.tone_rapport + dims.addressed_concern + dims.close_attempt) / 4;
      scores[sid] = (avg / 5) * 100;
    }
  }

  const challengerScore = scores[challenge.challenger_session_id as string] ?? 0;
  const challengedScore = scores[challenge.challenged_session_id as string] ?? 0;
  const winnerId = challengerScore >= challengedScore
    ? challenge.challenger_id as string
    : challenge.challenged_id as string;

  // Atomic update: only succeeds if status is still 'active'
  // If another callback already transitioned it, this returns no rows
  const { data: updated } = await serviceClient
    .from('peer_challenges')
    .update({
      challenger_score: challengerScore,
      challenged_score: challengedScore,
      winner_id: winnerId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', challengeId)
    .eq('status', 'active')
    .select()
    .maybeSingle();

  // If update returned no rows, another caller won the race
  if (!updated) return null;

  return {
    complete: true,
    challengerScore,
    challengedScore,
    winnerId,
    challengerDimensions: dimensionScores[challenge.challenger_session_id as string],
    challengedDimensions: dimensionScores[challenge.challenged_session_id as string],
  };
}

/**
 * Extract best and worst dimensions from a scores object.
 */
export function extractBestWorstDimensions(
  scores: Record<string, number> | undefined
): { best: string; worst: string } {
  if (!scores || Object.keys(scores).length === 0) {
    return { best: 'overall', worst: 'overall' };
  }

  const entries = Object.entries(scores);
  entries.sort((a, b) => b[1] - a[1]);
  const best = entries[0]?.[0] ?? 'overall';
  const worst = entries[entries.length - 1]?.[0] ?? 'overall';

  return { best, worst };
}

/**
 * Build abbreviated peer challenge results SMS.
 * Validates length and truncates if needed to fit 2 SMS segments (320 chars).
 */
export function buildPeerResultsSMS(
  yourScore: number,
  opponentScore: number,
  opponentName: string,
  youWon: boolean,
  bestDimension: string,
  weakestDimension: string
): string {
  const result = youWon ? `You win!` : `${opponentName} wins.`;
  let sms = `Challenge result: You ${Math.round(yourScore)}%, ${opponentName} ${Math.round(opponentScore)}%. ${result} Your strength: ${bestDimension.replace(/_/g, ' ')}. Work on: ${weakestDimension.replace(/_/g, ' ')}.`;

  // Truncate to fit 2 SMS segments (320 GSM-7 chars)
  if (sms.length > 320) {
    sms = sms.substring(0, 317) + '...';
  }

  return sms;
}

/**
 * Expire peer challenges that have timed out.
 * Called from orphaned-sessions cron.
 */
export async function expirePeerChallenges(): Promise<{ expired: number; defaultWins: number }> {
  const now = new Date().toISOString();

  // Disambiguating expired → cancel
  const { data: disambExpired } = await serviceClient
    .from('peer_challenges')
    .select('id')
    .eq('status', 'disambiguating')
    .lt('expires_at', now);

  for (const c of disambExpired ?? []) {
    await serviceClient
      .from('peer_challenges')
      .update({ status: 'expired' })
      .eq('id', c.id as string);
  }

  // Pending expired (challenged never accepted) → cancel
  const { data: pendingExpired } = await serviceClient
    .from('peer_challenges')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', now);

  for (const c of pendingExpired ?? []) {
    await serviceClient
      .from('peer_challenges')
      .update({ status: 'expired' })
      .eq('id', c.id as string);
  }

  // Active expired (one didn't respond) → default win
  const { data: activeExpired } = await serviceClient
    .from('peer_challenges')
    .select('id, challenger_id, challenged_id, challenger_session_id, challenged_session_id')
    .eq('status', 'active')
    .lt('expires_at', now);

  let defaultWins = 0;
  for (const c of activeExpired ?? []) {
    // Whoever has a completed session wins
    let winnerId = c.challenger_id as string;
    if (c.challenger_session_id && !c.challenged_session_id) winnerId = c.challenger_id as string;
    else if (c.challenged_session_id && !c.challenger_session_id) winnerId = c.challenged_id as string;

    await serviceClient
      .from('peer_challenges')
      .update({ status: 'completed', winner_id: winnerId, completed_at: now })
      .eq('id', c.id as string);
    defaultWins++;
  }

  return {
    expired: (disambExpired?.length ?? 0) + (pendingExpired?.length ?? 0),
    defaultWins,
  };
}

function isChallengeDay(frequency: string): boolean {
  const day = new Date().getDay();
  switch (frequency) {
    case 'daily': return day >= 1 && day <= 5;
    case 'mwf': return [1, 3, 5].includes(day);
    case 'tue_thu': return [2, 4].includes(day);
    default: return false;
  }
}
