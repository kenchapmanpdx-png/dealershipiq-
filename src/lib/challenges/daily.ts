// Phase 6B: Daily Challenge — generate shared scenario + rank results
// Morning: challenge scenario + yesterday's top 3 → all reps
// EOD: rank responses, text results

import { serviceClient } from '@/lib/supabase/service';
import { tokenLimitParam } from '@/lib/openai';
import type { ChallengeResult, GradingRubric } from '@/types/challenges';

/**
 * Generate today's daily challenge scenario for a dealership.
 * Called from morning meeting script cron (7am) or training cron (fallback).
 * Uses team's weakest adaptive weighting domain.
 */
export async function generateDailyChallenge(
  dealershipId: string,
  taxonomyDomain: string,
  frequency?: string
): Promise<{ id: string; scenarioText: string } | null> {
  // Defense in depth: verify today qualifies under the frequency config
  if (frequency) {
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    if (frequency === 'mwf' && ![1, 3, 5].includes(dayOfWeek)) return null;
    if (frequency === 'tue_thu' && ![2, 4].includes(dayOfWeek)) return null;
    if (frequency === 'daily' && (dayOfWeek === 0 || dayOfWeek === 6)) return null; // Skip weekends for daily
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Check if already exists
  const { data: existing } = await serviceClient
    .from('daily_challenges')
    .select('id, scenario_text')
    .eq('dealership_id', dealershipId)
    .eq('challenge_date', todayStr)
    .maybeSingle();

  if (existing) {
    return { id: existing.id as string, scenarioText: existing.scenario_text as string };
  }

  // Generate scenario via GPT
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const model = 'gpt-5.4-2026-03-05';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

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
            content: `Generate a team training challenge scenario for automotive salespeople.
Domain: ${taxonomyDomain.replace(/_/g, ' ')}
Output JSON: { "scenario_text": "under 300 chars, customer-facing, conversational", "grading_rubric": { "product_accuracy": "...", "tone_rapport": "...", "concern_addressed": "...", "close_attempt": "..." } }
Rules: Sound like a real customer. No meta-framing. No labels.`,
          },
          { role: 'user', content: `Generate a ${taxonomyDomain.replace(/_/g, ' ')} challenge for today.` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'challenge_scenario',
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

    if (!res.ok) throw new Error(`OpenAI ${model}: ${res.status}`);

    const data = await res.json();
    const content = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');

    const { data: row, error } = await serviceClient
      .from('daily_challenges')
      .insert({
        dealership_id: dealershipId,
        challenge_date: todayStr,
        scenario_text: content.scenario_text,
        grading_rubric: content.grading_rubric,
        taxonomy_domain: taxonomyDomain,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) throw error;
    return { id: row.id as string, scenarioText: content.scenario_text as string };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get yesterday's challenge results for the morning SMS.
 */
export async function getYesterdayResults(
  dealershipId: string
): Promise<{ top3: string[]; winnerName: string | null } | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data } = await serviceClient
    .from('daily_challenges')
    .select('results, status')
    .eq('dealership_id', dealershipId)
    .eq('challenge_date', yesterdayStr)
    .maybeSingle();

  if (!data || data.status !== 'completed') return null;

  const results = (data.results ?? []) as ChallengeResult[];
  if (results.length === 0) return null;

  const sorted = results.sort((a, b) => a.rank - b.rank);
  const top3 = sorted.slice(0, 3).map(r => `${r.first_name} (${Math.round(r.score)}%)`);

  return { top3, winnerName: sorted[0]?.first_name ?? null };
}

/**
 * Build the morning challenge SMS combining results + scenario.
 */
export function buildChallengeMorningSMS(
  yesterdayResults: { top3: string[]; winnerName: string | null } | null,
  scenarioText: string
): string {
  const parts: string[] = [];

  if (yesterdayResults && yesterdayResults.top3.length > 0) {
    parts.push(`Yesterday's best: ${yesterdayResults.top3[0]}.`);
    if (yesterdayResults.top3.length > 1) {
      parts.push(`Top 3: ${yesterdayResults.top3.join(', ')}.`);
    }
  }

  parts.push(`TODAY: ${scenarioText} Best response by 5pm.`);

  let msg = parts.join(' ');
  // Trim to 2 SMS segments (306 chars GSM-7 safe)
  if (msg.length > 306) {
    msg = `TODAY: ${scenarioText} Best response by 5pm.`;
    if (msg.length > 306) {
      msg = scenarioText.slice(0, 280) + ' Best response by 5pm.';
    }
  }

  return msg;
}

/**
 * Rank challenge responses and build results.
 * Called by challenge-results cron at 5pm local.
 */
export async function rankChallengeResponses(
  challengeId: string,
  dealershipId: string
): Promise<{ results: ChallengeResult[]; participationCount: number }> {
  // Get all completed sessions linked to this challenge
  const { data: sessions } = await serviceClient
    .from('conversation_sessions')
    .select('id, user_id, created_at')
    .eq('challenge_id', challengeId)
    .eq('status', 'completed');

  if (!sessions || sessions.length === 0) {
    return { results: [], participationCount: 0 };
  }

  // Get training results for these sessions
  const sessionIds = sessions.map(s => s.id as string);
  const { data: trainingResults } = await serviceClient
    .from('training_results')
    .select('user_id, session_id, product_accuracy, tone_rapport, addressed_concern, close_attempt, created_at')
    .in('session_id', sessionIds);

  if (!trainingResults || trainingResults.length === 0) {
    return { results: [], participationCount: 0 };
  }

  // Calculate average score per user
  const userScores: Record<string, { total: number; count: number; earliestResponse: string; userId: string }> = {};

  for (const r of trainingResults) {
    const uid = r.user_id as string;
    const avg = (
      (r.product_accuracy as number) +
      (r.tone_rapport as number) +
      (r.addressed_concern as number) +
      (r.close_attempt as number)
    ) / 4;
    const pct = (avg / 5) * 100;

    if (!userScores[uid]) {
      userScores[uid] = { total: 0, count: 0, earliestResponse: r.created_at as string, userId: uid };
    }
    userScores[uid].total += pct;
    userScores[uid].count++;
    if ((r.created_at as string) < userScores[uid].earliestResponse) {
      userScores[uid].earliestResponse = r.created_at as string;
    }
  }

  // Sort: highest score first, earliest response breaks ties
  const sorted = Object.values(userScores)
    .map(s => ({ userId: s.userId, score: s.total / s.count, earliestResponse: s.earliestResponse }))
    .sort((a, b) => b.score - a.score || a.earliestResponse.localeCompare(b.earliestResponse));

  // Look up first names
  const userIds = sorted.map(s => s.userId);
  const { data: users } = await serviceClient
    .from('users')
    .select('id, full_name')
    .in('id', userIds);

  const nameMap: Record<string, string> = {};
  for (const u of users ?? []) {
    const name = (u.full_name as string) ?? '';
    nameMap[u.id as string] = name.split(/\s+/)[0] || 'Unknown';
  }

  const results: ChallengeResult[] = sorted.map((s, i) => ({
    user_id: s.userId,
    first_name: nameMap[s.userId] ?? 'Unknown',
    score: Math.round(s.score),
    rank: i + 1,
  }));

  return { results, participationCount: results.length };
}

/**
 * Build EOD results SMS.
 */
export function buildResultsSMS(results: ChallengeResult[]): string {
  if (results.length === 0) return '';

  const top3 = results.slice(0, 3);
  const lines = top3.map(r => `${r.rank}. ${r.first_name} (${r.score}%)`);
  const winner = top3[0].first_name;

  return `Challenge results: ${lines.join(' ')}. ${winner} takes it today.`;
}
