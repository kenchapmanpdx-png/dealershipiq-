// Behavioral Scoring Expansion
// Adds urgency and competitive_positioning dimensions to grading.
// TODO: This file appears unused — verify and remove if confirmed

import { TrainingResult } from '@/types/database';

export interface ExpandedGradingResult extends TrainingResult {
  urgency?: number; // 1-5: How well addressed time pressure
  competitive_positioning?: number; // 1-5: How well compared to competitors
}

export interface ScoringSchema {
  includeUrgency: boolean;
  includeCompetitive: boolean;
  includeBase: boolean; // Always true
}

// Get scoring schema for a dealership (from feature flags)
export async function getExpandedGradingSchema(
  featureFlags: Record<string, unknown> = {}
): Promise<ScoringSchema> {
  return {
    includeUrgency: Boolean(featureFlags.scoring_urgency ?? false),
    includeCompetitive: Boolean(
      featureFlags.scoring_competitive ?? false
    ),
    includeBase: true,
  };
}

// Build expanded prompt with scoring instructions
export function buildExpandedPrompt(
  basePrompt: string,
  schema: ScoringSchema
): string {
  let expanded = basePrompt;

  if (schema.includeUrgency) {
    expanded += `

### Urgency Dimension (score 1-5)
If the customer expressed time pressure or urgency, evaluate how well the salesperson:
- Acknowledged and validated the time constraint
- Offered expedited options or solutions
- Maintained composure under pressure

Score:
- 1: Ignored urgency or made it worse
- 3: Acknowledged urgency but didn't offer solutions
- 5: Directly addressed urgency with concrete next steps`;
  }

  if (schema.includeCompetitive) {
    expanded += `

### Competitive Positioning Dimension (score 1-5)
If the customer mentioned competitors or comparisons, evaluate how well the salesperson:
- Acknowledged the competitor without dismissing it
- Honestly compared features/value
- Positioned the vehicle's unique strengths

Score:
- 1: Ignored competitors or made negative comparisons
- 3: Made generic claims without comparison
- 5: Provided specific, honest differentiation`;
  }

  return expanded;
}

// Extract expanded scores from grading response
export function extractExpandedScores(
  gradingText: string,
  schema: ScoringSchema
): Partial<ExpandedGradingResult> {
  const scores: Partial<ExpandedGradingResult> = {};

  if (schema.includeUrgency) {
    // Look for "Urgency: X" or similar patterns
    const urgencyMatch = gradingText.match(
      /urgency[\s:]*([1-5])/i
    );
    if (urgencyMatch) {
      scores.urgency = parseInt(urgencyMatch[1], 10);
    }
  }

  if (schema.includeCompetitive) {
    // Look for "Competitive: X" or "Competitive Positioning: X"
    const competitiveMatch = gradingText.match(
      /(?:competitive[\s_]?positioning|competitive)[\s:]*([1-5])/i
    );
    if (competitiveMatch) {
      scores.competitive_positioning = parseInt(competitiveMatch[1], 10);
    }
  }

  return scores;
}

// Validate expanded grading result
export function validateExpandedGradingResult(
  result: unknown,
  schema: ScoringSchema
): result is ExpandedGradingResult {
  if (typeof result !== 'object' || result === null) {
    return false;
  }

  const r = result as Record<string, unknown>;

  // Base fields required
  if (
    typeof r.product_accuracy !== 'number' ||
    typeof r.tone_rapport !== 'number' ||
    typeof r.addressed_concern !== 'number' ||
    typeof r.close_attempt !== 'number' ||
    typeof r.feedback !== 'string'
  ) {
    return false;
  }

  // Check expanded fields if present
  if (schema.includeUrgency && r.urgency !== undefined) {
    if (typeof r.urgency !== 'number' || r.urgency < 1 || r.urgency > 5) {
      return false;
    }
  }

  if (schema.includeCompetitive && r.competitive_positioning !== undefined) {
    if (
      typeof r.competitive_positioning !== 'number' ||
      r.competitive_positioning < 1 ||
      r.competitive_positioning > 5
    ) {
      return false;
    }
  }

  return true;
}
