// Phase 6C: Scenario chain lifecycle — start/continue/branch/complete/expire

import { serviceClient } from '@/lib/supabase/service';
import { tokenLimitParam } from '@/lib/openai';
import { selectBranch } from './branching';
import { loadTemplate, selectTemplate, substituteVars } from './templates';
import { getVehicleContextForScenario } from '@/lib/vehicle-data';
import type { ChainContext, StepResult, ScenarioChain } from '@/types/chains';

const CUSTOMER_NAMES = ['Mrs. Johnson', 'Mr. Patel', 'Sarah', 'David', 'Mrs. Torres', 'Mr. Kim'];
const EMOTIONAL_STATES = ['curious but cautious', 'interested but budget-conscious', 'ready to buy but needs reassurance', 'comparison shopping'];

/**
 * Start a new chain for a user. Returns the Day 1 scenario text.
 */
export async function startChain(
  userId: string,
  dealershipId: string,
  weakestDomains: string[],
  tenureWeeks: number
): Promise<{ chainId: string; scenarioText: string; taxonomyDomain: string } | null> {
  const difficulty = tenureWeeks <= 2 ? 'easy' : tenureWeeks <= 4 ? 'medium' : 'hard';
  const template = await selectTemplate(weakestDomains, difficulty);
  if (!template) return null;

  const customerName = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
  const emotionalState = EMOTIONAL_STATES[Math.floor(Math.random() * EMOTIONAL_STATES.length)];

  // Try to get vehicle context from actual data, fall back to generic
  let vehicleName = 'a popular model on your lot';
  let competitorName: string | null = null;
  try {
    const vehicleCtx = await getVehicleContextForScenario(dealershipId, weakestDomains[0] ?? 'objection_handling');
    if (vehicleCtx?.primary) {
      vehicleName = `${vehicleCtx.primary.model_year.year} ${vehicleCtx.primary.make.name} ${vehicleCtx.primary.model.name}`;
    }
    if (vehicleCtx?.competitor) {
      competitorName = `${vehicleCtx.competitor.model_year.year} ${vehicleCtx.competitor.make.name} ${vehicleCtx.competitor.model.name}`;
    }
  } catch {
    // Fall back to generic vehicle
  }

  const context: ChainContext = {
    customer_name: customerName,
    vehicle: vehicleName,
    competitor_vehicle: competitorName,
    stated_objections: [],
    prior_responses_summary: '',
    emotional_state: emotionalState,
    branch_taken: null,
  };

  // Generate Day 1 scenario from template step 1
  const step1 = template.stepPrompts.find(s => s.step === 1);
  if (!step1) return null;

  const promptText = step1.base_prompt
    ? substituteVars(step1.base_prompt, context)
    : `${customerName} walks onto the lot looking at vehicles.`;

  // Generate actual scenario text via GPT
  const scenarioText = await generateChainScenario(promptText, context, step1.persona);

  // Create chain row
  const { data, error } = await serviceClient
    .from('scenario_chains')
    .insert({
      dealership_id: dealershipId,
      user_id: userId,
      chain_template_id: template.id,
      current_step: 1,
      total_steps: template.totalSteps,
      chain_context: context,
      step_results: [],
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;

  return {
    chainId: data.id as string,
    scenarioText,
    taxonomyDomain: template.taxonomyDomains[0] ?? 'objection_handling',
  };
}

/**
 * Continue a chain — generate next step scenario based on prior results.
 */
export async function continueChain(
  chain: ScenarioChain
): Promise<{ scenarioText: string; taxonomyDomain: string } | null> {
  const template = await loadTemplate(chain.chainTemplateId);
  if (!template) return null;

  const nextStep = chain.currentStep + 1;
  if (nextStep > chain.totalSteps) return null;

  const stepConfig = template.stepPrompts.find(s => s.step === nextStep);
  if (!stepConfig) return null;

  // Get the previous step's result for branching
  const lastResult = chain.stepResults[chain.stepResults.length - 1];
  if (!lastResult) return null;

  // Select branch based on previous scores
  const branch = selectBranch(stepConfig, lastResult);

  // Update chain context with narrative continuity
  const updatedContext: ChainContext = {
    ...chain.chainContext,
    branch_taken: Object.keys(stepConfig.branch_rules ?? {}).find(k => {
      const rule = stepConfig.branch_rules?.[k];
      if (!rule) return false;
      const match = rule.match(/^(\w+)\s*(<|>|<=|>=)\s*([\d.]+)$/);
      if (!match) return false;
      const [, dim, op, thr] = match;
      const score = lastResult.scores[dim];
      if (score == null) return false;
      const t = parseFloat(thr);
      return op === '<' ? score < t : op === '>' ? score > t : false;
    }) ?? 'default',
    prior_responses_summary: `Day ${chain.currentStep}: ${lastResult.feedback.slice(0, 100)}`,
    emotional_state: branch.persona.situation,
  };

  const promptText = substituteVars(branch.prompt, updatedContext);
  const scenarioText = await generateChainScenario(promptText, updatedContext, branch.persona);

  // Update chain in DB
  await serviceClient
    .from('scenario_chains')
    .update({
      current_step: nextStep,
      chain_context: updatedContext,
      last_step_at: new Date().toISOString(),
      work_days_without_response: 0,
    })
    .eq('id', chain.id);

  return {
    scenarioText,
    taxonomyDomain: template.taxonomyDomains[Math.min(nextStep - 1, template.taxonomyDomains.length - 1)] ?? 'objection_handling',
  };
}

/**
 * Record step result after grading completes for a chain-linked session.
 * H-011: Uses Supabase RPC for atomic read-check-write to prevent race conditions.
 * Falls back to application-level check if RPC not available.
 */
export async function recordChainStepResult(
  chainId: string,
  stepResult: StepResult
): Promise<boolean> {
  // Try atomic RPC first (requires record_chain_step function in DB)
  const { data: rpcResult, error: rpcError } = await serviceClient
    .rpc('record_chain_step', {
      p_chain_id: chainId,
      p_step: stepResult.step,
      p_result: stepResult,
    });

  // If RPC exists and succeeded, use its result
  if (!rpcError) {
    return !!rpcResult;
  }

  // Fallback: application-level check (original logic, still has race window)
  console.warn('[chains] record_chain_step RPC not available, using fallback:', rpcError.message);

  const { data: chain } = await serviceClient
    .from('scenario_chains')
    .select('step_results, current_step, total_steps')
    .eq('id', chainId)
    .single();

  if (!chain) return false;

  const existingResults = (chain.step_results as StepResult[]) ?? [];

  // Defense in depth: verify this step hasn't already been recorded
  if (existingResults.some(r => r.step === stepResult.step)) {
    return (chain.current_step as number) >= (chain.total_steps as number);
  }

  const results = [...existingResults, stepResult];
  const isComplete = (chain.current_step as number) >= (chain.total_steps as number);

  await serviceClient
    .from('scenario_chains')
    .update({
      step_results: results,
      status: isComplete ? 'completed' : 'active',
      last_step_at: new Date().toISOString(),
    })
    .eq('id', chainId);

  return isComplete;
}

/**
 * Build chain completion summary SMS.
 */
export function buildChainCompletionSMS(
  customerName: string,
  stepResults: StepResult[]
): string {
  const scores = stepResults.map((r, i) => `Day ${i + 1}: ${Math.round((Object.values(r.scores).reduce((a, b) => a + b, 0) / Object.values(r.scores).length / 5) * 100)}%`);
  const first = stepResults[0] ? Object.values(stepResults[0].scores).reduce((a, b) => a + b, 0) / Object.values(stepResults[0].scores).length : 0;
  const last = stepResults[stepResults.length - 1] ? Object.values(stepResults[stepResults.length - 1].scores).reduce((a, b) => a + b, 0) / Object.values(stepResults[stepResults.length - 1].scores).length : 0;
  const improved = last > first;

  return `${customerName}'s story is complete. Your scores: ${scores.join(', ')}. ${improved ? 'Nice improvement across the arc.' : 'Solid effort. Review your feedback for growth areas.'}`;
}

/**
 * Increment work_days_without_response for a chain. Expire if >= 3.
 */
export async function incrementMissedDay(chainId: string): Promise<boolean> {
  const { data } = await serviceClient
    .from('scenario_chains')
    .select('work_days_without_response')
    .eq('id', chainId)
    .single();

  if (!data) return false;

  const missed = (data.work_days_without_response as number) + 1;

  if (missed >= 3) {
    await serviceClient
      .from('scenario_chains')
      .update({ status: 'expired', work_days_without_response: missed })
      .eq('id', chainId);
    return true; // expired
  }

  await serviceClient
    .from('scenario_chains')
    .update({ work_days_without_response: missed })
    .eq('id', chainId);
  return false;
}

/**
 * Load an active chain for a user.
 */
export async function getActiveChain(userId: string): Promise<ScenarioChain | null> {
  const { data } = await serviceClient
    .from('scenario_chains')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    dealershipId: data.dealership_id as string,
    userId: data.user_id as string,
    chainTemplateId: data.chain_template_id as string,
    currentStep: data.current_step as number,
    totalSteps: data.total_steps as number,
    chainContext: data.chain_context as ChainContext,
    stepResults: (data.step_results ?? []) as StepResult[],
    status: data.status as ScenarioChain['status'],
    workDaysWithoutResponse: data.work_days_without_response as number,
    startedAt: data.started_at as string,
    lastStepAt: data.last_step_at as string | null,
  };
}

// --- Internal: generate scenario text from template prompt via GPT ---
async function generateChainScenario(
  promptTemplate: string,
  context: ChainContext,
  persona?: { mood: string; situation: string } | null
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const model = 'gpt-5.4-2026-03-05';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const moodInfo = persona ? `Customer mood: ${persona.mood}. Situation: ${persona.situation}.` : '';
  const priorInfo = context.prior_responses_summary
    ? `Prior context: ${context.prior_responses_summary}`
    : '';

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
            content: `You are writing a customer dialogue for automotive sales training. Generate what the customer says — natural, conversational, under 300 characters. No meta-framing, no labels, no emoji. Just the customer talking. ${moodInfo} ${priorInfo}`,
          },
          { role: 'user', content: promptTemplate },
        ],
        temperature: 0.7,
        ...tokenLimitParam(model, 200),
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`OpenAI ${model}: ${res.status}`);

    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? promptTemplate).slice(0, 300);
  } catch {
    return promptTemplate.slice(0, 300);
  } finally {
    clearTimeout(timeout);
  }
}
