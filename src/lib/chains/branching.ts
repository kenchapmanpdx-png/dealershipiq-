// Phase 6C: Deterministic branch selection for scenario chains
// NOT LLM-driven. Rules evaluated against prior step scores.

import type { StepPrompt, StepResult } from '@/types/chains';
import { log } from '@/lib/logger';

/**
 * Select which branch to use for the next step based on prior grading scores.
 * Rule format: "dimension_name < threshold" (e.g., "close_attempt < 2.5")
 */
export function selectBranch(
  stepConfig: StepPrompt,
  previousResult: StepResult
): { prompt: string; persona: { mood: string; situation: string } } {
  // Step 1 or no branches — use base_prompt
  if (!stepConfig.branches || !stepConfig.branch_rules) {
    return {
      prompt: stepConfig.base_prompt ?? '',
      persona: stepConfig.persona ?? { mood: 'friendly', situation: 'first visit' },
    };
  }

  // Evaluate branch rules in order
  for (const [branchName, ruleString] of Object.entries(stepConfig.branch_rules)) {
    const match = ruleString.match(/^(\w+)\s*(<|>|<=|>=)\s*([\d.]+)$/);
    if (!match) {
      // H5: log malformed rules so scenario-bank authors notice.
      log.warn('chains.branching.invalid_rule_format', {
        branch_name: branchName,
        rule_string: ruleString,
      });
      continue;
    }

    const [, dimension, operator, thresholdStr] = match;
    const score = previousResult.scores[dimension];
    const threshold = parseFloat(thresholdStr);

    if (score == null) {
      // H5: log when a rule references a dimension the grader didn't emit.
      log.warn('chains.branching.missing_dimension', {
        branch_name: branchName,
        rule_string: ruleString,
        dimension,
        available_dimensions: Object.keys(previousResult.scores ?? {}),
      });
      continue;
    }

    const triggered =
      operator === '<' ? score < threshold :
      operator === '>' ? score > threshold :
      operator === '<=' ? score <= threshold :
      operator === '>=' ? score >= threshold : false;

    if (triggered && stepConfig.branches[branchName]) {
      return stepConfig.branches[branchName];
    }
  }

  // Default branch
  if (stepConfig.branches['default']) {
    return stepConfig.branches['default'];
  }

  // H5: Absolute fallback — author did not provide a default. Log so the
  // scenario template can be fixed; otherwise every rep on this chain
  // silently gets the generic fallback.
  log.warn('chains.branching.absolute_fallback_used', {
    branches_available: Object.keys(stepConfig.branches ?? {}),
    rules_configured: Object.keys(stepConfig.branch_rules ?? {}),
  });
  return {
    prompt: 'The customer comes back, ready to continue the conversation.',
    persona: { mood: 'neutral', situation: 'follow-up visit' },
  };
}
