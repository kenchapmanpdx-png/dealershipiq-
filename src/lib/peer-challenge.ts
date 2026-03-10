/**
 * Peer Challenge Mode: Head-to-head training
 *
 * Rep texts CHALLENGE [name] → both get same scenario → AI grades both → results to both
 * Challenge = the training for that day (counts as daily messages for both)
 * 4-hour expiry, no-show = default win for challenger
 */

import { getOpenAICompletion } from './openai';
import {
  getUserByName,
  createPeerChallenge,
  getPeerChallenge,
  updatePeerChallenge,
  getExpiredPeerChallenges,
} from './service-db';

export interface PeerChallengeContext {
  id: string;
  dealershipId: string;
  challengerId: string;
  challengedId: string;
  scenarioText: string;
  challengerResponse?: string;
  challengerScore?: Record<string, number>;
  challengedResponse?: string;
  challengedScore?: Record<string, number>;
  status: 'pending' | 'active' | 'completed' | 'expired' | 'no_show';
  expiresAt: string;
  createdAt: string;
}

/**
 * Parse CHALLENGE keyword from SMS text
 * Format: "CHALLENGE John" or "Challenge John Smith"
 */
export function parseChallengeKeyword(text: string): string | null {
  const match = text.match(/^CHALLENGE\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Create a new peer challenge
 * Looks up challenged user by name, generates scenario
 */
export async function createChallenge(
  challengerId: string,
  challengedName: string,
  dealershipId: string
): Promise<string> {
  // Look up challenged user by name (first + last name search)
  const challengedUser = await getUserByName(challengedName, dealershipId);

  if (!challengedUser) {
    throw new Error(`User not found: ${challengedName}`);
  }

  if (challengedUser.id === challengerId) {
    throw new Error('Cannot challenge yourself');
  }

  // Generate scenario
  const scenario = await generateChallengeScenario(dealershipId);

  // Create challenge with 4-hour expiry
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  const challengeId = await createPeerChallenge({
    dealershipId,
    challengerId,
    challengedId: challengedUser.id,
    scenarioText: scenario,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
  });

  return challengeId;
}

/**
 * Submit challenge response from either participant
 */
export async function submitChallengeResponse(
  challengeId: string,
  userId: string,
  response: string
): Promise<void> {
  const challenge = await getPeerChallenge(challengeId);

  if (!challenge) {
    throw new Error(`Challenge not found: ${challengeId}`);
  }

  if (challenge.status !== 'pending' && challenge.status !== 'active') {
    throw new Error(`Challenge cannot accept responses in status: ${challenge.status}`);
  }

  // Check if user is a participant
  if (userId !== challenge.challenger_id && userId !== challenge.challenged_id) {
    throw new Error('User is not a participant in this challenge');
  }

  // Check expiration
  if (new Date() > new Date(challenge.expires_at)) {
    await updatePeerChallenge(challengeId, { status: 'expired' });
    throw new Error('Challenge has expired');
  }

  const updateData: Record<string, unknown> = {
    status: 'active',
  };

  if (userId === challenge.challenger_id) {
    updateData.challenger_response = response;
  } else {
    updateData.challenged_response = response;
  }

  await updatePeerChallenge(challengeId, updateData);
}

/**
 * Grade both responses and determine winner
 * Called when both participants have submitted
 */
export async function gradeChallengeResponses(
  challengeId: string
): Promise<{
  challengerId: string;
  challengedId: string;
  challengerScore: Record<string, number>;
  challengedScore: Record<string, number>;
  winner: string; // user_id of winner
  tie: boolean;
}> {
  const challenge = await getPeerChallenge(challengeId);

  if (!challenge) {
    throw new Error(`Challenge not found: ${challengeId}`);
  }

  if (!challenge.challenger_response || !challenge.challenged_response) {
    throw new Error('Both participants must submit responses before grading');
  }

  // Grade both responses
  const [challengerScore, challengedScore] = await Promise.all([
    gradeResponse(challenge.scenario_text, challenge.challenger_response),
    gradeResponse(challenge.scenario_text, challenge.challenged_response),
  ]);

  // Determine winner (higher overall score)
  const challengerTotal = Object.values(challengerScore).reduce((a: number, b: number) => a + b, 0);
  const challengedTotal = Object.values(challengedScore).reduce((a: number, b: number) => a + b, 0);

  const winner = challengerTotal > challengedTotal ? challenge.challenger_id : challenge.challenged_id;
  const tie = challengerTotal === challengedTotal;

  await updatePeerChallenge(challengeId, {
    challenger_score: challengerScore,
    challenged_score: challengedScore,
    status: 'completed',
  });

  return {
    challengerId: challenge.challenger_id,
    challengedId: challenge.challenged_id,
    challengerScore,
    challengedScore,
    winner,
    tie,
  };
}

/**
 * Find and handle expired peer challenges
 * Awards default win to challenger if no-show
 */
export async function expirePendingChallenges(): Promise<
  Array<{
    challengeId: string;
    challengerId: string;
    challengedId: string;
    winner: string;
  }>
> {
  const expiredChallenges = await getExpiredPeerChallenges();
  const handled: Array<{
    challengeId: string;
    challengerId: string;
    challengedId: string;
    winner: string;
  }> = [];

  for (const challenge of expiredChallenges) {
    // Default win to challenger on no-show
    const winner = challenge.status === 'pending' ? challenge.challenger_id : challenge.challenged_id;

    const status = challenge.challenger_response || challenge.challenged_response ? 'completed' : 'no_show';

    await updatePeerChallenge(challenge.id, {
      status,
    });

    handled.push({
      challengeId: challenge.id,
      challengerId: challenge.challenger_id,
      challengedId: challenge.challenged_id,
      winner,
    });
  }

  return handled;
}

/**
 * Get challenge details for display
 */
export async function getChallenge(
  challengeId: string
): Promise<PeerChallengeContext | null> {
  const challenge = await getPeerChallenge(challengeId);

  if (!challenge) return null;

  return {
    id: challenge.id,
    dealershipId: challenge.dealership_id,
    challengerId: challenge.challenger_id,
    challengedId: challenge.challenged_id,
    scenarioText: challenge.scenario_text,
    challengerResponse: challenge.challenger_response,
    challengerScore: challenge.challenger_score,
    challengedResponse: challenge.challenged_response,
    challengedScore: challenge.challenged_score,
    status: challenge.status,
    expiresAt: challenge.expires_at,
    createdAt: challenge.created_at,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a scenario for peer challenge
 */
async function generateChallengeScenario(_dealershipId: string): Promise<string> {
  const prompt = `You are an automotive sales trainer. Create a realistic, challenging sales scenario for peer-to-peer competition.

The scenario should:
1. Be framed as a customer voice, not abstract knowledge
2. Present a realistic objection or buying situation
3. Test closing ability and customer rapport
4. Be completable in 1-2 SMS messages
5. Be interesting/engaging to make the challenge fun

Generate ONE peer challenge scenario:`;

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-4o-mini',
      {
        temperature: 0.8,
        max_tokens: 250,
      },
      'peer_challenge_scenario'
    );

    return response || getDefaultPeerScenario();
  } catch (error) {
    console.error('Failed to generate peer challenge scenario:', error);
    return getDefaultPeerScenario();
  }
}

/**
 * Grade a single response using AI
 */
async function gradeResponse(
  scenario: string,
  response: string
): Promise<Record<string, number>> {
  const prompt = `You are an automotive sales trainer grading a peer challenge response.

Scenario: ${scenario}

Rep's response: ${response}

Grade on a scale of 1-5 for each dimension:
- product_knowledge: Did they demonstrate product knowledge?
- customer_rapport: Did they build connection with the customer?
- closing_technique: Did they attempt a close or advance the sale?
- confidence: Did they sound confident and professional?

Respond in JSON format only: {"product_knowledge": X, "customer_rapport": X, "closing_technique": X, "confidence": X}`;

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-4o-mini',
      {
        temperature: 0.3,
        max_tokens: 100,
      },
      'peer_challenge_grading'
    );

    // Parse JSON response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return getDefaultGradeScore();
  } catch (error) {
    console.error('Failed to grade challenge response:', error);
    return getDefaultGradeScore();
  }
}

function getDefaultPeerScenario(): string {
  const scenarios = [
    'A customer comes in asking about the new Honda Civic. They say "I like the look, but I\'m not sure about the reliability compared to Toyota." How do you respond?',
    'A customer is interested in the CR-V but mentions their budget is tight. "What\'s the cheapest way I can get into this vehicle?" What\'s your approach?',
    'A customer asking about the Accord says they\'re comparing it to the Camry. "Why should I get the Honda instead?" How do you make the case?',
  ];

  return scenarios[Math.floor(Math.random() * scenarios.length)];
}

function getDefaultGradeScore(): Record<string, number> {
  return {
    product_knowledge: 3,
    customer_rapport: 3,
    closing_technique: 3,
    confidence: 3,
  };
}
