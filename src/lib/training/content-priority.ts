// Phase 6: Training content priority — single function, called by daily training cron
// Priority order (first match wins):
// 1. Manager Quick-Create scenario (unexpired, not yet pushed)
// 2. Active peer challenge scenario (status = 'active')
// 3. Active scenario chain (next step due today)
// 4. Daily challenge (if daily_challenge_enabled for this day)
// 5. Adaptive-weighted standalone scenario (Phase 4 default)

import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled, getFeatureFlagConfig } from '@/lib/service-db';
import { getLocalDateString, getLocalDayOfWeek } from '@/lib/quiet-hours';
import type { ChallengeFrequency } from '@/types/challenges';

export interface ContentSelection {
  type: 'manager_scenario' | 'peer_challenge' | 'chain_step' | 'daily_challenge' | 'adaptive';
  /** Row ID from the source table */
  sourceId?: string;
  /** Pre-generated scenario text (for manager/challenge/chain) */
  scenarioText?: string;
  /** Grading rubric (for manager/challenge scenarios) */
  gradingRubric?: Record<string, unknown>;
  /** Taxonomy domain override */
  taxonomyDomain?: string;
  /** Persona mood override */
  personaMood?: string | null;
  /** Chain-specific */
  chainStep?: number;
  /** Challenge ID to link session */
  challengeId?: string;
  /** Chain ID to link session */
  chainId?: string;
}

/**
 * Select content for a specific employee. Evaluates priority order.
 * Returns null for 'adaptive' type — caller handles default flow.
 */
export async function selectContent(
  userId: string,
  dealershipId: string,
  timezone?: string
): Promise<ContentSelection> {
  // 1. Manager Quick-Create scenario
  const managerScenario = await checkManagerScenario(dealershipId);
  if (managerScenario) return managerScenario;

  // 2. Active peer challenge (F7-M-001: scoped by dealership)
  const peerChallenge = await checkPeerChallenge(userId, dealershipId);
  if (peerChallenge) return peerChallenge;

  // 3. Active scenario chain
  const chainStep = await checkChainStep(userId, dealershipId);
  if (chainStep) return chainStep;

  // 4. Daily challenge (F6-M-001: uses dealership timezone)
  const dailyChallenge = await checkDailyChallenge(dealershipId, timezone);
  if (dailyChallenge) return dailyChallenge;

  // 5. Adaptive-weighted standalone (default)
  return { type: 'adaptive' };
}

async function checkManagerScenario(
  dealershipId: string
): Promise<ContentSelection | null> {
  const enabled = await isFeatureEnabled(dealershipId, 'manager_quick_create_enabled');
  if (!enabled) return null;

  const { data } = await serviceClient
    .from('manager_scenarios')
    .select('id, scenario_text, grading_rubric, taxonomy_domain')
    .eq('dealership_id', dealershipId)
    .is('pushed_at', null)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    type: 'manager_scenario',
    sourceId: data.id as string,
    scenarioText: data.scenario_text as string,
    gradingRubric: data.grading_rubric as Record<string, unknown>,
    taxonomyDomain: data.taxonomy_domain as string,
  };
}

async function checkPeerChallenge(
  userId: string,
  dealershipId: string
): Promise<ContentSelection | null> {
  // F7-M-001: Scope by dealership_id to prevent cross-tenant challenge leakage
  const { data } = await serviceClient
    .from('peer_challenges')
    .select('id, scenario_text, grading_rubric, taxonomy_domain')
    .eq('status', 'active')
    .eq('dealership_id', dealershipId)
    .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!data || !data.scenario_text) return null;

  return {
    type: 'peer_challenge',
    sourceId: data.id as string,
    scenarioText: data.scenario_text as string,
    gradingRubric: data.grading_rubric as Record<string, unknown>,
    taxonomyDomain: data.taxonomy_domain as string | undefined,
  };
}

async function checkChainStep(
  userId: string,
  dealershipId: string
): Promise<ContentSelection | null> {
  const enabled = await isFeatureEnabled(dealershipId, 'scenario_chains_enabled');
  if (!enabled) return null;

  const { data: chain } = await serviceClient
    .from('scenario_chains')
    .select('id, current_step, total_steps, chain_template_id, chain_context, step_results')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!chain) return null;

  return {
    type: 'chain_step',
    chainId: chain.id as string,
    chainStep: chain.current_step as number,
    sourceId: chain.chain_template_id as string,
  };
}

async function checkDailyChallenge(
  dealershipId: string,
  timezone?: string
): Promise<ContentSelection | null> {
  const enabled = await isFeatureEnabled(dealershipId, 'daily_challenge_enabled');
  if (!enabled) return null;

  const tz = timezone || 'America/New_York';

  // Check frequency config
  const config = await getFeatureFlagConfig(dealershipId, 'daily_challenge_enabled');
  const frequency: ChallengeFrequency = (config?.frequency as ChallengeFrequency) ?? 'mwf';
  if (!isChallengeDayLocal(frequency, tz)) return null;

  // F6-M-001: Use dealership-local date, not UTC
  const todayStr = getLocalDateString(tz);
  const { data } = await serviceClient
    .from('daily_challenges')
    .select('id, scenario_text, grading_rubric, taxonomy_domain, persona_mood')
    .eq('dealership_id', dealershipId)
    .eq('challenge_date', todayStr)
    .eq('status', 'active')
    .maybeSingle();

  if (!data) return null;

  return {
    type: 'daily_challenge',
    challengeId: data.id as string,
    scenarioText: data.scenario_text as string,
    gradingRubric: data.grading_rubric as Record<string, unknown>,
    taxonomyDomain: data.taxonomy_domain as string | undefined,
    personaMood: data.persona_mood as string | null,
  };
}

// F6-M-001: Use dealership-local day-of-week, not UTC
function isChallengeDayLocal(frequency: ChallengeFrequency, timezone: string): boolean {
  const day = getLocalDayOfWeek(timezone); // 0=Sun, 1=Mon, ...
  switch (frequency) {
    case 'daily': return day >= 1 && day <= 5;
    case 'mwf': return [1, 3, 5].includes(day);
    case 'tue_thu': return [2, 4].includes(day);
    default: return false;
  }
}
