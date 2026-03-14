// Phase 6C: Chain template loading + variable substitution
// F5-M-002: serviceClient justified — chain_templates is global reference data (no dealership_id).
// All callers are in cron/webhook context (SMS inbound, daily-training) where no Supabase JWT exists.
// RLS policy: USING(true) for authenticated SELECT (added in C-001 migration).

import { serviceClient } from '@/lib/supabase/service';
import type { ChainTemplate, StepPrompt, ChainContext } from '@/types/chains';

/**
 * Load a chain template by ID.
 */
export async function loadTemplate(templateId: string): Promise<ChainTemplate | null> {
  const { data, error } = await serviceClient
    .from('chain_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    description: data.description as string | null,
    totalSteps: data.total_steps as number,
    stepPrompts: data.step_prompts as StepPrompt[],
    difficulty: data.difficulty as 'easy' | 'medium' | 'hard',
    taxonomyDomains: data.taxonomy_domains as string[],
    vehicleRequired: data.vehicle_required as boolean,
  };
}

/**
 * Select a template based on employee's weakest domains and tenure difficulty.
 */
export async function selectTemplate(
  weakestDomains: string[],
  difficulty: 'easy' | 'medium' | 'hard'
): Promise<ChainTemplate | null> {
  // Try to find a template matching the weakest domain and difficulty
  for (const domain of weakestDomains) {
    const { data } = await serviceClient
      .from('chain_templates')
      .select('*')
      .contains('taxonomy_domains', [domain])
      .eq('difficulty', difficulty)
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        id: data.id as string,
        name: data.name as string,
        description: data.description as string | null,
        totalSteps: data.total_steps as number,
        stepPrompts: data.step_prompts as StepPrompt[],
        difficulty: data.difficulty as 'easy' | 'medium' | 'hard',
        taxonomyDomains: data.taxonomy_domains as string[],
        vehicleRequired: data.vehicle_required as boolean,
      };
    }
  }

  // Fallback: any template at matching difficulty
  const { data: fallback } = await serviceClient
    .from('chain_templates')
    .select('*')
    .eq('difficulty', difficulty)
    .limit(1)
    .maybeSingle();

  if (!fallback) {
    // Last resort: any template
    const { data: any_ } = await serviceClient
      .from('chain_templates')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (!any_) return null;
    return {
      id: any_.id as string,
      name: any_.name as string,
      description: any_.description as string | null,
      totalSteps: any_.total_steps as number,
      stepPrompts: any_.step_prompts as StepPrompt[],
      difficulty: any_.difficulty as 'easy' | 'medium' | 'hard',
      taxonomyDomains: any_.taxonomy_domains as string[],
      vehicleRequired: any_.vehicle_required as boolean,
    };
  }

  return {
    id: fallback.id as string,
    name: fallback.name as string,
    description: fallback.description as string | null,
    totalSteps: fallback.total_steps as number,
    stepPrompts: fallback.step_prompts as StepPrompt[],
    difficulty: fallback.difficulty as 'easy' | 'medium' | 'hard',
    taxonomyDomains: fallback.taxonomy_domains as string[],
    vehicleRequired: fallback.vehicle_required as boolean,
  };
}

/**
 * Apply variable substitution to a prompt template.
 * Variables: {customer_name}, {vehicle}, {competitor_vehicle}
 */
export function substituteVars(prompt: string, context: ChainContext): string {
  return prompt
    .replace(/\{customer_name\}/g, context.customer_name)
    .replace(/\{vehicle\}/g, context.vehicle)
    .replace(/\{competitor_vehicle\}/g, context.competitor_vehicle ?? 'a competitor vehicle')
    .replace(/\{emotional_state\}/g, context.emotional_state);
}
