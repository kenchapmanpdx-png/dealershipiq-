// Phase 6A: Manager Quick-Create — AI scenario generation from manager SMS
// TRAIN: keyword → strip prefix → GPT-4o generates scenario + rubric → store → confirm

import { serviceClient } from '@/lib/supabase/service';
import { tokenLimitParam } from '@/lib/openai';
import type { GeneratedScenario } from '@/types/challenges';

const GENERATE_SYSTEM_PROMPT = `You are a training content specialist for automotive dealership salespeople.

A sales manager described a situation they want their team to practice.

Generate a training scenario as JSON:
{
  "scenario_text": "Customer-facing text, under 300 chars, conversational",
  "customer_persona": "brief description",
  "taxonomy_domain": "objection_handling|product_knowledge|closing_technique|competitive_positioning|financing",
  "difficulty": "easy|medium|hard",
  "grading_rubric": {
    "product_accuracy": "what to look for",
    "tone_rapport": "what to look for",
    "concern_addressed": "what to look for",
    "close_attempt": "what to look for",
    "urgency_creation": "what to look for or null if not relevant",
    "competitive_positioning": "what to look for or null if not relevant"
  }
}

Rules:
- Scenario must feel like a real customer interaction
- Rubric reflects what the manager described
- If manager mentions a specific vehicle, use provided vehicle data
- If description is vague, make reasonable assumptions about the customer situation
- scenario_text is what the customer says — no meta-framing, no labels`;

/**
 * Generate a training scenario from manager's text input via GPT-4o.
 */
export async function generateScenarioFromManager(
  managerInput: string
): Promise<GeneratedScenario> {
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
          { role: 'system', content: GENERATE_SYSTEM_PROMPT },
          { role: 'user', content: managerInput },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'generated_scenario',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                scenario_text: { type: 'string' },
                customer_persona: { type: 'string' },
                taxonomy_domain: { type: 'string' },
                difficulty: { type: 'string' },
                grading_rubric: {
                  type: 'object',
                  properties: {
                    product_accuracy: { type: 'string' },
                    tone_rapport: { type: 'string' },
                    concern_addressed: { type: 'string' },
                    close_attempt: { type: 'string' },
                    urgency_creation: { type: ['string', 'null'] },
                    competitive_positioning: { type: ['string', 'null'] },
                  },
                  required: ['product_accuracy', 'tone_rapport', 'concern_addressed', 'close_attempt'],
                  additionalProperties: false,
                },
              },
              required: ['scenario_text', 'customer_persona', 'taxonomy_domain', 'difficulty', 'grading_rubric'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.7,
        ...tokenLimitParam(model, 600),
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`OpenAI ${model}: ${res.status}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty OpenAI response');

    return JSON.parse(content) as GeneratedScenario;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Store generated scenario in manager_scenarios table.
 * Returns the created row ID.
 */
export async function storeManagerScenario(params: {
  dealershipId: string;
  createdBy: string;
  managerInput: string;
  scenario: GeneratedScenario;
}): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60_000); // 30 min

  const { data, error } = await serviceClient
    .from('manager_scenarios')
    .insert({
      dealership_id: params.dealershipId,
      created_by: params.createdBy,
      source: 'manager_sms',
      manager_input_text: params.managerInput,
      scenario_text: params.scenario.scenario_text,
      customer_persona: params.scenario.customer_persona,
      taxonomy_domain: params.scenario.taxonomy_domain,
      difficulty: params.scenario.difficulty,
      grading_rubric: params.scenario.grading_rubric,
      awaiting_now_confirmation: true,
      now_confirmation_expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Check if a manager has a pending NOW confirmation.
 */
export async function getPendingNowConfirmation(
  managerId: string
): Promise<{ id: string; scenarioText: string } | null> {
  const { data } = await serviceClient
    .from('manager_scenarios')
    .select('id, scenario_text')
    .eq('created_by', managerId)
    .eq('awaiting_now_confirmation', true)
    .gt('now_confirmation_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id as string, scenarioText: data.scenario_text as string };
}

/**
 * Mark a manager scenario as pushed immediately (NOW confirmation).
 */
export async function markScenarioPushedNow(scenarioId: string): Promise<void> {
  await serviceClient
    .from('manager_scenarios')
    .update({
      awaiting_now_confirmation: false,
      push_immediately: true,
      pushed_at: new Date().toISOString(),
    })
    .eq('id', scenarioId);
}

/**
 * Clear NOW confirmation without pushing (manager sent something else).
 */
export async function clearNowConfirmation(scenarioId: string): Promise<void> {
  await serviceClient
    .from('manager_scenarios')
    .update({ awaiting_now_confirmation: false })
    .eq('id', scenarioId);
}

/**
 * Mark a manager scenario as pushed by the training cron.
 */
export async function markScenarioPushed(scenarioId: string): Promise<void> {
  await serviceClient
    .from('manager_scenarios')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', scenarioId);
}
