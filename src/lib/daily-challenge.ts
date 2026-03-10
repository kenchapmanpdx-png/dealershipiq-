/**
 * Daily Challenge: Team leaderboard push
 *
 * Morning cron: yesterday's top 3 + today's shared challenge (same scenario for all employees)
 * End-of-day cron: grade all challenge responses, text top 3
 * Message counts toward 3-message daily cap
 */

import { getOpenAICompletion } from './openai';
import {
  createDailyChallenge as createDailyChallengeDb,
  getDailyChallenge,
  updateDailyChallenge,
  getEligibleUsersForChallenge,
} from './service-db';

export interface DailyChallengeContext {
  id: string;
  dealershipId: string;
  challengeDate: string;
  scenarioText: string;
  gradingRubric: Record<string, unknown>;
  results: Array<{
    userId: string;
    phone: string;
    response: string;
    score: Record<string, number>;
    rank?: number;
  }>;
  topPerformers?: Array<{
    userId: string;
    phone: string;
    name: string;
    score: number;
  }>;
}

export interface ChallengeResult {
  userId: string;
  phone: string;
  name?: string;
  response: string;
  score: Record<string, number>;
  totalScore: number;
}

/**
 * Create a daily challenge for a dealership
 */
export async function createDailyChallenge(
  dealershipId: string,
  scenario?: string
): Promise<string> {
  // Generate scenario if not provided
  const scenarioText = scenario || (await generateChallengeScenario(dealershipId));

  // Create grading rubric for this scenario
  const rubric = {
    product_knowledge: {
      weight: 0.25,
      description: 'Demonstrates product knowledge relevant to scenario',
    },
    customer_rapport: {
      weight: 0.25,
      description: 'Builds connection and understanding with customer',
    },
    closing_technique: {
      weight: 0.3,
      description: 'Attempts to advance sale or close',
    },
    professionalism: {
      weight: 0.2,
      description: 'Maintains professional tone and confidence',
    },
  };

  const challengeId = await createDailyChallengeRecord({
    dealershipId,
    challengeDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    scenarioText,
    gradingRubric: rubric,
    results: [],
  });

  return challengeId;
}

/**
 * Submit a challenge result from an employee
 */
export async function submitChallengeResult(
  challengeId: string,
  userId: string,
  phone: string,
  response: string
): Promise<void> {
  const challenge = await getDailyChallenge(challengeId);

  if (!challenge) {
    throw new Error(`Challenge not found: ${challengeId}`);
  }

  // Grade the response
  const score = await gradeResponse(challenge.scenario_text, response, challenge.grading_rubric);

  // Add to results
  const results = challenge.results || [];
  results.push({
    userId,
    phone,
    response,
    score,
    timestamp: new Date().toISOString(),
  });

  await updateDailyChallenge(challengeId, { results });
}

/**
 * Get challenge results ranked by performance
 */
export async function getChallengeResults(challengeId: string): Promise<ChallengeResult[]> {
  const challenge = await getDailyChallenge(challengeId);

  if (!challenge) {
    throw new Error(`Challenge not found: ${challengeId}`);
  }

  const results = challenge.results || [];

  // Calculate total scores and sort
  const ranked = results
    .map((r: Record<string, unknown>) => {
      const scores = r.score as Record<string, number>;
      const totalScore = Object.values(scores).reduce((a: number, b: number) => a + b, 0) / Object.keys(scores).length;

      return {
        userId: r.userId as string,
        phone: r.phone as string,
        name: r.name as string | undefined,
        response: r.response as string,
        score: scores,
        totalScore,
      };
    })
    .sort((a: ChallengeResult, b: ChallengeResult) => b.totalScore - a.totalScore);

  return ranked;
}

/**
 * Get top 3 performers for a challenge (for morning message)
 */
export async function getTopPerformers(challengeId: string, count: number = 3) {
  const results = await getChallengeResults(challengeId);
  return results.slice(0, count);
}

/**
 * Generate today's challenge scenario
 */
export async function generateChallengeScenario(dealershipId: string): Promise<string> {
  const prompt = `You are an automotive sales trainer. Create an engaging, team-friendly sales challenge scenario.

The scenario should:
1. Be appropriate for all skill levels (new reps and veterans should both be able to perform)
2. Be framed as a realistic customer interaction
3. Test fundamental sales skills: listening, product knowledge, closing
4. Be completable in 1-2 SMS messages
5. Make for a fun team competition

Generate ONE daily challenge scenario for a dealership's entire team:`;

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-4o-mini',
      {
        temperature: 0.8,
        max_tokens: 250,
      },
      'daily_challenge_scenario'
    );

    return response || getDefaultChallengeScenario();
  } catch (error) {
    console.error('Failed to generate daily challenge scenario:', error);
    return getDefaultChallengeScenario();
  }
}

/**
 * Format results for SMS to top performers
 */
export function formatTopPerformersMessage(
  dealershipName: string,
  topPerformers: ChallengeResult[],
  date: string
): string {
  if (topPerformers.length === 0) {
    return `📊 ${dealershipName} - ${date}\n\nNo submissions yet. Start the challenge!`;
  }

  const lines = [`📊 ${dealershipName} - ${date}\n`];

  topPerformers.forEach((performer, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
    const score = Math.round(performer.totalScore);
    lines.push(`${medal} ${performer.name || performer.phone}: ${score}/100`);
  });

  return lines.join('\n');
}

/**
 * Format leaderboard for dashboard display
 */
export function formatLeaderboard(
  results: ChallengeResult[]
): Array<{
  rank: number;
  name: string;
  score: number;
  isTopPerformer: boolean;
}> {
  return results.slice(0, 10).map((r, index) => ({
    rank: index + 1,
    name: r.name || r.phone,
    score: Math.round(r.totalScore),
    isTopPerformer: index < 3,
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Grade a single challenge response
 */
async function gradeResponse(
  scenario: string,
  response: string,
  rubric: Record<string, unknown>
): Promise<Record<string, number>> {
  const prompt = `You are an automotive sales trainer grading a daily challenge response.

Challenge Scenario: ${scenario}

Rep's Response: ${response}

Grade on a scale of 1-5 for each dimension:
- product_knowledge: Does the response demonstrate product knowledge relevant to this scenario?
- customer_rapport: Does the response build connection with the customer?
- closing_technique: Does the response attempt to advance the sale or close?
- professionalism: Is the tone professional and confident?

Respond in JSON format only: {"product_knowledge": X, "customer_rapport": X, "closing_technique": X, "professionalism": X}`;

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-4o-mini',
      {
        temperature: 0.3,
        max_tokens: 100,
      },
      'daily_challenge_grading'
    );

    // Parse JSON response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Normalize to 0-100 scale
      const normalized: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        normalized[key] = (value as number) * 20;
      });
      return normalized;
    }

    return getDefaultGradeScore();
  } catch (error) {
    console.error('Failed to grade challenge response:', error);
    return getDefaultGradeScore();
  }
}

async function createDailyChallengeRecord(data: {
  dealershipId: string;
  challengeDate: string;
  scenarioText: string;
  gradingRubric: Record<string, unknown>;
  results: unknown[];
}): Promise<string> {
  // This will call service-db.createDailyChallenge
  // Implemented in service-db.ts
  return createDailyChallengeDb(data);
}

function getDefaultChallengeScenario(): string {
  const scenarios = [
    'A customer walks in interested in the new Accord. They say: "I\'ve been driving Toyotas for 10 years, but I like how this looks. Is it really as reliable?" How do you respond?',
    'A customer is comparing the CR-V to the Chevy Equinox. They ask: "What makes the Honda worth the extra $3,000?" Make your case.',
    'A customer interested in the Civic says: "I want to make sure it\'ll last me 150,000 miles. What warranty do you have?" Walk them through it.',
    'A customer asks about fuel economy on the Accord Hybrid. They say: "I spend $200/month on gas. Would this actually save me money?" How do you break it down?',
  ];

  return scenarios[Math.floor(Math.random() * scenarios.length)];
}

function getDefaultGradeScore(): Record<string, number> {
  return {
    product_knowledge: 60,
    customer_rapport: 60,
    closing_technique: 60,
    professionalism: 60,
  };
}
