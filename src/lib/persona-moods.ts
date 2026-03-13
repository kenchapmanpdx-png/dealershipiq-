// Phase 4A: Persona Mood Selection
// Tenure-based progression: friendly → skeptical/rushed → angry/no-credit
// Mood affects AI customer tone, NOT grading criteria.
// Setup text must be brutally concise (under 40 chars of context).

export type PersonaMood =
  | 'friendly'
  | 'skeptical'
  | 'rushed'
  | 'price_shopping'
  | 'angry_spouse'
  | 'no_credit'
  | 'impatient';

interface MoodConfig {
  mood: PersonaMood;
  /** Short customer context injected into scenario prompt. Under 40 chars. */
  setupHint: string;
  /** Prompt modifier for AI customer behavior */
  promptModifier: string;
  /** Weight for random selection within tier (higher = more likely) */
  weight: number;
}

// Tier 1: Weeks 1-2 (friendly/neutral only)
const TIER_1_MOODS: MoodConfig[] = [
  {
    mood: 'friendly',
    setupHint: 'Customer is upbeat and engaged',
    promptModifier: 'You are a friendly, engaged customer. Respond positively to good rapport. Ask genuine follow-up questions.',
    weight: 3,
  },
  {
    mood: 'price_shopping',
    setupHint: 'Comparing prices at 3 dealers',
    promptModifier: 'You are comparison shopping at 3 dealers. Ask about price matching, total cost, and deals. Budget is your main concern.',
    weight: 1,
  },
];

// Tier 2: Weeks 3-4 (add skeptical, rushed)
const TIER_2_MOODS: MoodConfig[] = [
  {
    mood: 'friendly',
    setupHint: 'Customer is upbeat and engaged',
    promptModifier: 'You are a friendly, engaged customer. Respond positively to good rapport. Ask genuine follow-up questions.',
    weight: 2,
  },
  {
    mood: 'skeptical',
    setupHint: 'Customer doubts your claims',
    promptModifier: 'You are skeptical. Challenge every claim with "Really?" or "Prove it." Demand specific evidence. Distrust marketing talk.',
    weight: 2,
  },
  {
    mood: 'rushed',
    setupHint: 'Customer has 15 min to decide',
    promptModifier: 'You have 15 minutes before school pickup. Be impatient with long explanations. Want bottom-line answers fast.',
    weight: 2,
  },
  {
    mood: 'price_shopping',
    setupHint: 'Comparing prices at 3 dealers',
    promptModifier: 'You are comparison shopping at 3 dealers. Ask about price matching, total cost, and deals. Budget is your main concern.',
    weight: 1,
  },
  {
    mood: 'impatient',
    setupHint: 'Customer wants quick answers only',
    promptModifier: 'You are busy and impatient. Cut off long answers. Respect efficiency. Get frustrated by rambling or vague responses.',
    weight: 1,
  },
];

// Tier 3: Week 5+ (full roster including angry, no-credit)
const TIER_3_MOODS: MoodConfig[] = [
  {
    mood: 'friendly',
    setupHint: 'Customer is upbeat and engaged',
    promptModifier: 'You are a friendly, engaged customer. Respond positively to good rapport. Ask genuine follow-up questions.',
    weight: 1,
  },
  {
    mood: 'skeptical',
    setupHint: 'Customer doubts your claims',
    promptModifier: 'You are skeptical. Challenge every claim with "Really?" or "Prove it." Demand specific evidence. Distrust marketing talk.',
    weight: 2,
  },
  {
    mood: 'rushed',
    setupHint: 'Customer has 15 min to decide',
    promptModifier: 'You have 15 minutes before school pickup. Be impatient with long explanations. Want bottom-line answers fast.',
    weight: 2,
  },
  {
    mood: 'price_shopping',
    setupHint: 'Comparing prices at 3 dealers',
    promptModifier: 'You are comparison shopping at 3 dealers. Ask about price matching, total cost, and deals. Budget is your main concern.',
    weight: 2,
  },
  {
    mood: 'angry_spouse',
    setupHint: 'Spouse is against the purchase',
    promptModifier: 'Your spouse is firmly against this purchase. You like the car but need ammunition to convince them. Ask about value retention, safety, practicality.',
    weight: 2,
  },
  {
    mood: 'no_credit',
    setupHint: 'Customer has poor credit history',
    promptModifier: 'You have a 520 credit score and are embarrassed about it. Dance around the topic. Need help with financing options without judgment.',
    weight: 1,
  },
  {
    mood: 'impatient',
    setupHint: 'Customer wants quick answers only',
    promptModifier: 'You are busy and impatient. Cut off long answers. Respect efficiency. Get frustrated by rambling or vague responses.',
    weight: 1,
  },
];

// H-015: All moods for lookup — must include ALL tiers for getMoodPromptModifier()
const ALL_MOODS: MoodConfig[] = [...TIER_1_MOODS, ...TIER_2_MOODS, ...TIER_3_MOODS];

function weightedRandom(moods: MoodConfig[]): MoodConfig {
  const totalWeight = moods.reduce((sum, m) => sum + m.weight, 0);
  let r = Math.random() * totalWeight;
  for (const m of moods) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return moods[0];
}

/**
 * Select a persona mood based on user tenure (weeks in training).
 */
export function selectPersonaMood(tenureWeeks: number): {
  mood: PersonaMood;
  setupHint: string;
  promptModifier: string;
} {
  let pool: MoodConfig[];

  if (tenureWeeks <= 2) {
    pool = TIER_1_MOODS;
  } else if (tenureWeeks <= 4) {
    pool = TIER_2_MOODS;
  } else {
    pool = TIER_3_MOODS;
  }

  const selected = weightedRandom(pool);
  return {
    mood: selected.mood,
    setupHint: selected.setupHint,
    promptModifier: selected.promptModifier,
  };
}

/**
 * Get the prompt modifier for a specific mood name.
 */
export function getMoodPromptModifier(mood: PersonaMood): string {
  const found = ALL_MOODS.find((m) => m.mood === mood);
  return found?.promptModifier ?? '';
}

/**
 * Build the persona context string for injection into scenario generation prompts.
 * Returns empty string if mood is null/friendly (baseline).
 */
export function buildPersonaContext(mood: PersonaMood | null, setupHint?: string): string {
  if (!mood || mood === 'friendly') return '';
  return `\n[Customer mood: ${setupHint || mood}]`;
}

/**
 * Get streak milestone message prefix, or empty string if no milestone.
 * Milestones at: 3, 7, 14, 30, 60, 90 days.
 */
export function getStreakMilestone(streak: number): string {
  const milestones: Record<number, string> = {
    3: '3 DAYS IN! Building a habit.',
    7: '7-DAY STREAK! Top performers train daily.',
    14: 'DAY 14: Most quit by Day 7. Not you.',
    30: '30-DAY STREAK! Top 5% consistency.',
    60: '60 DAYS STRONG! Elite level.',
    90: '90-DAY LEGEND! Unstoppable.',
  };
  return milestones[streak] ?? '';
}
