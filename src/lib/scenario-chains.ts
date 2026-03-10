/**
 * Scenario Chains: Progressive 3-day storylines
 *
 * Day N grading feeds Day N+1 scenario generation.
 * Creates narrative continuity across training sessions.
 */

import { getOpenAICompletion } from './openai';
import {
  getScenarioChain,
  createScenarioChain,
  updateScenarioChain,
  getScenarioChainByUserDealership,
} from './service-db';

export interface ScenarioChainStep {
  stepNumber: number;
  scenarioText: string;
  response?: string;
  score?: Record<string, number>;
  feedback?: string;
  completedAt?: string;
}

export interface ScenarioChainContext {
  chainId: string;
  userId: string;
  dealershipId: string;
  currentStep: number;
  maxSteps: number;
  narrativeContext: Record<string, unknown>;
  stepResults: Record<string, unknown>[];
  status: 'active' | 'completed' | 'abandoned';
}

/**
 * Get or create an active chain for a user at a dealership
 * Returns existing active chain or creates a new one
 */
export async function getOrCreateChain(
  userId: string,
  dealershipId: string
): Promise<ScenarioChainContext> {
  // Check for existing active chain
  const existing = await getScenarioChainByUserDealership(userId, dealershipId);

  if (existing && existing.status === 'active') {
    return {
      chainId: existing.id,
      userId: existing.user_id,
      dealershipId: existing.dealership_id,
      currentStep: existing.current_step,
      maxSteps: existing.max_steps,
      narrativeContext: existing.narrative_context || {},
      stepResults: existing.step_results || [],
      status: existing.status,
    };
  }

  // Create new chain
  const chainId = await createScenarioChain(userId, dealershipId, {
    currentStep: 1,
    maxSteps: 3,
    narrativeContext: {},
    stepResults: [],
    status: 'active',
  });

  return {
    chainId,
    userId,
    dealershipId,
    currentStep: 1,
    maxSteps: 3,
    narrativeContext: {},
    stepResults: [],
    status: 'active',
  };
}

/**
 * Advance chain to next step after recording step result
 * Updates narrative context based on previous step's grading
 */
export async function advanceChain(
  chainId: string,
  stepResult: {
    response: string;
    score: Record<string, number>;
    feedback: string;
  }
): Promise<void> {
  const chain = await getScenarioChain(chainId);

  if (!chain) {
    throw new Error(`Scenario chain not found: ${chainId}`);
  }

  if (chain.status !== 'active') {
    throw new Error(`Chain is not active: ${chain.status}`);
  }

  const updatedResults = [
    ...chain.step_results,
    {
      step: chain.current_step,
      ...stepResult,
      timestamp: new Date().toISOString(),
    },
  ];

  const newStep = chain.current_step + 1;

  // Update context for next step (preserve key points from grading)
  const updatedContext = {
    ...chain.narrative_context,
    lastStepScore: stepResult.score,
    lastStepFeedback: stepResult.feedback,
    improvedAreas: extractImprovedAreas(stepResult.feedback),
    stepCompletionDate: new Date().toISOString(),
  };

  await updateScenarioChain(chainId, {
    currentStep: newStep,
    narrativeContext: updatedContext,
    stepResults: updatedResults,
    status: newStep > chain.max_steps ? 'completed' : 'active',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark chain as completed when all steps are done
 */
export async function completeChain(chainId: string): Promise<void> {
  const chain = await getScenarioChain(chainId);

  if (!chain) {
    throw new Error(`Scenario chain not found: ${chainId}`);
  }

  await updateScenarioChain(chainId, {
    status: 'completed',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Abandon chain due to timeout or user opt-out
 */
export async function abandonChain(chainId: string): Promise<void> {
  const chain = await getScenarioChain(chainId);

  if (!chain) {
    throw new Error(`Scenario chain not found: ${chainId}`);
  }

  await updateScenarioChain(chainId, {
    status: 'abandoned',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Generate Day N+1 scenario using narrative context from Day N grading
 *
 * Chains scenarios together: if Day 1 was about product knowledge,
 * Day 2 might be about applying that knowledge in a customer interaction.
 */
export async function generateChainScenario(
  chain: ScenarioChainContext,
  step: number
): Promise<string> {
  const previousSteps = chain.stepResults.slice(0, step - 1);
  const improvementAreas = chain.narrativeContext.improvedAreas as string[] | undefined;

  // Build prompt that references previous steps and targeted improvements
  const prompt = buildChainPrompt(step, chain.maxSteps, previousSteps, improvementAreas);

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-5.4',
      {
        temperature: 0.7,
        max_tokens: 300,
      },
      `scenario_chain_step_${step}`
    );

    return response || getDefaultScenario(step);
  } catch (error) {
    console.error(`Failed to generate scenario chain step ${step}:`, error);
    return getDefaultScenario(step);
  }
}

/**
 * Check if user has an active chain at this dealership
 */
export async function isChainActive(
  userId: string,
  dealershipId: string
): Promise<boolean> {
  const chain = await getScenarioChainByUserDealership(userId, dealershipId);
  return chain !== null && chain.status === 'active';
}

/**
 * Get current step's scenario for a chain
 */
export async function getChainScenario(
  chainId: string
): Promise<string | null> {
  const chain = await getScenarioChain(chainId);

  if (!chain) return null;

  // For now, generate scenario fresh each time
  // In production, you might cache this in a separate field
  return generateChainScenario(
    {
      chainId: chain.id,
      userId: chain.user_id,
      dealershipId: chain.dealership_id,
      currentStep: chain.current_step,
      maxSteps: chain.max_steps,
      narrativeContext: chain.narrative_context || {},
      stepResults: chain.step_results || [],
      status: chain.status,
    },
    chain.current_step
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildChainPrompt(
  step: number,
  maxSteps: number,
  previousSteps: unknown[],
  improvementAreas?: string[]
): string {
  const stepContext = previousSteps.length > 0 ? buildStepContext(previousSteps) : '';
  const improvementNote =
    improvementAreas && improvementAreas.length > 0
      ? `\n\nFocus on improving: ${improvementAreas.join(', ')}`
      : '';

  return `You are an automotive sales trainer. This is Step ${step} of a ${maxSteps}-day progressive training scenario.

${stepContext ? `Previous context:\n${stepContext}\n` : ''}

Create a realistic customer interaction scenario that:
1. Builds on the previous step's context (if available)
2. Tests the rep's application of learned concepts
3. Is framed as a customer voice, not abstract knowledge
4. Is appropriate for a floor salesperson
5. Can be responded to in 1-2 SMS messages${improvementNote}

Scenario:`;
}

function buildStepContext(steps: unknown[]): string {
  if (!steps || steps.length === 0) return '';

  return steps
    .map((s: unknown, i: number) => {
      const step = s as Record<string, unknown>;
      return `Step ${i + 1}: Score ${step.score}, Areas to improve: ${step.feedback}`;
    })
    .join('\n');
}

function extractImprovedAreas(feedback: string): string[] {
  // Simple extraction of improvement areas from feedback
  // In production, this could use NLP or structured feedback data
  const areas: string[] = [];

  const improvements = feedback.match(/Level up: (.+?)(?:💡|$)/gi);
  if (improvements) {
    improvements.forEach((imp) => {
      const text = imp
        .replace(/Level up: /i, '')
        .replace(/💡.*$/i, '')
        .trim();
      if (text) areas.push(text);
    });
  }

  return areas;
}

function getDefaultScenario(step: number): string {
  const scenarios: Record<number, string> = {
    1: 'A customer walks in asking about the 2024 CR-V. They mention they have two kids and a dog, and do a lot of camping. What do you tell them about the CR-V that would appeal to them?',
    2: 'The same customer is now asking about MPG and fuel efficiency compared to the Highlander. How do you handle this comparison?',
    3: 'The customer seems interested but is concerned about the monthly payment. How do you confidently discuss pricing without overstepping into F&I territory?',
  };

  return scenarios[step] || scenarios[1];
}
