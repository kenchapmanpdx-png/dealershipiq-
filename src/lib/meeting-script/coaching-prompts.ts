// Phase 4.5B: Curated coaching focus prompts per domain.
// Manager reads these aloud in the morning meeting.
// Variables: {top_model}, {competitor_model} — filled from vehicle data at assembly time.
// If no vehicle data, use generic versions (remove variable references).

export const COACHING_PROMPTS: Record<string, string[]> = {
  objection_handling: [
    'Quick round: Customer says "I need to think about it." Go around the room -- what do you say?',
    'Scenario: Customer says "Your competitor has the same car for less." Who wants to take this one?',
    'Pop quiz: What is the difference between a price objection and a value objection? Someone explain.',
  ],
  product_knowledge: [
    'Without looking: Name 3 features that are standard on our best-selling trim but NOT on the competitor base model.',
    'Challenge: Walk me through a 60-second elevator pitch on the {top_model}. Who is up?',
    'Quick check: What is the MPG difference between our hybrid and the competitor? Anyone?',
  ],
  closing_technique: [
    'Roleplay time: I am the customer. I just finished the test drive and I liked it. Close me. Who is first?',
    'Question: What is your go-to transition from test drive to the desk? Let us hear 2-3 approaches.',
    'Think about your last lost deal. What was the one thing you could have said differently? Share with the group.',
  ],
  competitive_positioning: [
    'Scenario: Customer walks in holding a printout from the competitor. How do you NOT trash them but still win?',
    'Name one specific number -- MPG, cargo, price -- where we beat the competition. Be specific.',
    'A customer says "I am going to check out the {competitor_model} too." What is your response?',
  ],
  financing: [
    'Customer asks: "What is my monthly payment going to be?" You do not have the numbers yet. What do you say?',
    'Quick one: What is the difference between APR and money factor? Can someone explain it to a customer?',
    'Scenario: Customer has fair credit and is worried about approval. How do you keep them in the deal?',
  ],
};

/**
 * Select a coaching prompt for the given domain.
 * MVP: random selection from the array.
 * Future: track last_used_at per domain per dealership for rotation.
 */
export function selectCoachingPrompt(
  domain: string,
  topModel?: string | null,
  competitorModel?: string | null
): string | null {
  const prompts = COACHING_PROMPTS[domain];
  if (!prompts || prompts.length === 0) {
    // M-015: Log unknown domains so missing content is visible
    if (!COACHING_PROMPTS[domain]) {
      console.warn(`[coaching-prompts] Unknown domain: "${domain}". Known: ${Object.keys(COACHING_PROMPTS).join(', ')}`);
    }
    return null;
  }

  const idx = Math.floor(Math.random() * prompts.length);
  let prompt = prompts[idx];

  // Variable substitution
  if (topModel) {
    prompt = prompt.replace(/\{top_model\}/g, topModel);
  } else {
    // Remove variable references for generic version
    prompt = prompt.replace(/\s*on the \{top_model\}/g, '');
    prompt = prompt.replace(/\{top_model\}/g, 'our top model');
  }

  if (competitorModel) {
    prompt = prompt.replace(/\{competitor_model\}/g, competitorModel);
  } else {
    prompt = prompt.replace(/the \{competitor_model\}/g, 'another brand');
    prompt = prompt.replace(/\{competitor_model\}/g, 'another brand');
  }

  return prompt;
}

/** Domain display names for the coaching focus header */
export const DOMAIN_LABELS: Record<string, string> = {
  objection_handling: 'objection handling',
  product_knowledge: 'product knowledge',
  closing_technique: 'closing technique',
  competitive_positioning: 'competitive positioning',
  financing: 'financing',
};
