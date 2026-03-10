// Adaptive Weighting System for Training Intelligence
// Per-employee priority vector across taxonomy domains.
// Formula: new_weight = old_weight * (1 - α) + score_delta * α
// Where score_delta = threshold - actual_score, α=0.3, β=0.1, threshold=3.0

import {
  getEmployeePriorityVector,
  upsertPriorityVector,
  getLastTrainingDomain,
  getAdaptiveWeightingConfig,
} from '@/lib/service-db';

export type TrainingDomain =
  | 'objection_handling'
  | 'product_knowledge'
  | 'closing_technique'
  | 'competitive_positioning'
  | 'financing';

export interface PriorityVector {
  objection_handling: number;
  product_knowledge: number;
  closing_technique: number;
  competitive_positioning: number;
  financing: number;
}

export interface AdaptiveConfig {
  alpha: number; // learning rate for weight updates
  beta: number; // exploration bonus
  threshold: number; // target score
  k_values: Record<string, number>; // domain-specific constants
}

const DEFAULT_CONFIG: AdaptiveConfig = {
  alpha: 0.3,
  beta: 0.1,
  threshold: 3.0,
  k_values: {
    objection_handling: 1.0,
    product_knowledge: 1.0,
    closing_technique: 1.0,
    competitive_positioning: 1.0,
    financing: 1.0,
  },
};

const DOMAINS: TrainingDomain[] = [
  'objection_handling',
  'product_knowledge',
  'closing_technique',
  'competitive_positioning',
  'financing',
];

// Initialize a new employee's priority vector (equal weights)
function initializeVector(): PriorityVector {
  const weight = 1 / DOMAINS.length;
  return {
    objection_handling: weight,
    product_knowledge: weight,
    closing_technique: weight,
    competitive_positioning: weight,
    financing: weight,
  };
}

// Get current priority vector for an employee
export async function getEmployeePriorityVectorForDomain(
  userId: string,
  dealershipId: string
): Promise<PriorityVector> {
  const vector = await getEmployeePriorityVector(userId, dealershipId);
  if (!vector) {
    return initializeVector();
  }
  return {
    objection_handling: vector.objection_handling ?? 0.2,
    product_knowledge: vector.product_knowledge ?? 0.2,
    closing_technique: vector.closing_technique ?? 0.2,
    competitive_positioning: vector.competitive_positioning ?? 0.2,
    financing: vector.financing ?? 0.2,
  };
}

// Update priority vector after a grading result
export async function updatePriorityVectorAfterGrading(
  userId: string,
  dealershipId: string,
  domain: TrainingDomain,
  actualScore: number,
  config: AdaptiveConfig = DEFAULT_CONFIG
): Promise<PriorityVector> {
  const current = await getEmployeePriorityVectorForDomain(userId, dealershipId);
  const updated = { ...current };

  // Calculate score delta
  const scoreDelta = config.threshold - actualScore;

  // Update the trained domain's weight
  const oldWeight = current[domain];
  const newWeight = oldWeight * (1 - config.alpha) + scoreDelta * config.alpha;
  updated[domain] = Math.max(0, Math.min(1, newWeight)); // Clamp to [0, 1]

  // Normalize weights so they sum to 1
  const sum = Object.values(updated).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const key of DOMAINS) {
      updated[key] = updated[key] / sum;
    }
  }

  // Persist to database
  await upsertPriorityVector(userId, dealershipId, updated);

  return updated;
}

// Select training domain using weighted random sampling with hard constraints
export async function selectTrainingDomain(
  userId: string,
  dealershipId: string,
  config: AdaptiveConfig = DEFAULT_CONFIG
): Promise<TrainingDomain> {
  const vector = await getEmployeePriorityVectorForDomain(userId, dealershipId);
  const lastDomain = await getLastTrainingDomain(userId, dealershipId);

  // Build candidate domains (exclude last domain)
  const candidates = DOMAINS.filter((d) => d !== lastDomain);
  if (candidates.length === 0) {
    // If somehow all are the same, pick any
    candidates.push(...DOMAINS);
  }

  // Weighted random sampling
  const weights = candidates.map((d) => vector[d] + config.beta); // Add exploration bonus
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalized = weights.map((w) => w / totalWeight);

  let cumulative = 0;
  const random = Math.random();
  for (let i = 0; i < candidates.length; i++) {
    cumulative += normalized[i];
    if (random <= cumulative) {
      return candidates[i];
    }
  }

  // Fallback (shouldn't reach)
  return candidates[candidates.length - 1];
}

// Get adaptive configuration for a dealership (from feature flags)
export async function getAdaptiveConfig(
  dealershipId: string
): Promise<AdaptiveConfig> {
  try {
    const config = await getAdaptiveWeightingConfig(dealershipId);
    return config || DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
