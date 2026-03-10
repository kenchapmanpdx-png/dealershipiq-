/**
 * Manager Quick-Create via SMS
 *
 * Manager texts scenario idea → AI formats into training content → approval flow
 * Manager sends SMS with keyword CREATE: followed by scenario description
 * AI reformats into structured training content
 * Approval via SMS (APPROVE/REJECT keywords)
 */

import { getOpenAICompletion } from './openai';
import {
  createCustomTrainingContent,
  updateCustomTrainingContent,
  getPendingApprovals,
  getApprovedContent,
} from './service-db';

export interface CustomTrainingContent {
  id: string;
  dealershipId: string;
  createdBy: string;
  rawInput: string;
  formattedScenario: string;
  mode: 'roleplay' | 'quiz' | 'objection';
  status: 'pending_approval' | 'approved' | 'rejected';
  createdAt: string;
}

/**
 * Parse CREATE keyword from SMS text
 * Format: "CREATE: Scenario description..." or "CREATE Scenario description..."
 */
export function parseCreateKeyword(text: string): string | null {
  const match = text.match(/^CREATE\s*:?\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Parse APPROVE/REJECT keywords
 */
export function parseApprovalKeyword(text: string): 'approve' | 'reject' | null {
  if (/^APPROVE\s*$/i.test(text)) return 'approve';
  if (/^REJECT\s*$/i.test(text)) return 'reject';
  return null;
}

/**
 * Format raw manager input into structured training content
 * Uses AI to understand intent and generate polished scenario
 */
export async function formatScenarioWithAI(
  rawInput: string,
  _dealershipId: string
): Promise<{
  formattedScenario: string;
  mode: 'roleplay' | 'quiz' | 'objection';
  rubric?: Record<string, unknown>;
}> {
  const prompt = `You are an automotive sales training content specialist.

A dealership manager submitted this training idea:
"${rawInput}"

Your job:
1. Identify the best training mode (roleplay, quiz, or objection)
2. Format it into a realistic, customer-voice scenario
3. Make it appropriate for SMS delivery (1-2 messages)
4. Ensure it tests applicable sales skills

Determine the mode:
- roleplay: customer interaction where rep must respond conversationally
- quiz: factual questions about products or processes
- objection: customer objection the rep must overcome

Format your response as:
MODE: [roleplay|quiz|objection]

SCENARIO:
[The formatted scenario text, 100-200 words]`;

  try {
    const response = await getOpenAICompletion(
      prompt,
      'gpt-5.4',
      {
        temperature: 0.7,
        max_tokens: 400,
      },
      'manager_content_format'
    );

    // Parse response
    const modeMatch = response.match(/MODE:\s*(roleplay|quiz|objection)/i);
    const scenarioMatch = response.match(/SCENARIO:\s*([\s\S]+?)(?=\n\n|$)/);

    const mode = (modeMatch ? modeMatch[1].toLowerCase() : 'roleplay') as 'roleplay' | 'quiz' | 'objection';
    const formattedScenario = scenarioMatch ? scenarioMatch[1].trim() : response;

    return {
      formattedScenario,
      mode,
      rubric: getGradingRubric(mode),
    };
  } catch (error) {
    console.error('Failed to format scenario with AI:', error);

    // Fallback: return the raw input as-is
    return {
      formattedScenario: rawInput,
      mode: 'roleplay',
      rubric: getGradingRubric('roleplay'),
    };
  }
}

/**
 * Create a new custom training content entry (submitted by manager)
 * Stores pending approval
 */
export async function createManagerContent(
  dealershipId: string,
  createdBy: string,
  rawInput: string,
  formattedScenario: string,
  mode: 'roleplay' | 'quiz' | 'objection'
): Promise<string> {
  const contentId = await createCustomTrainingContent({
    dealershipId,
    createdBy,
    rawInput,
    formattedScenario,
    mode,
    status: 'pending_approval',
  });

  return contentId;
}

/**
 * Get pending approvals for a dealership
 */
export async function getPendingContent(
  dealershipId: string
): Promise<CustomTrainingContent[]> {
  const pending = await getPendingApprovals(dealershipId);

  return pending.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    dealershipId: p.dealership_id as string,
    createdBy: p.created_by as string,
    rawInput: p.raw_input as string,
    formattedScenario: p.formatted_scenario as string,
    mode: p.mode as 'roleplay' | 'quiz' | 'objection',
    status: 'pending_approval' as const,
    createdAt: p.created_at as string,
  }));
}

/**
 * Approve content for use in training
 */
export async function approveContent(contentId: string): Promise<void> {
  await updateCustomTrainingContent(contentId, {
    status: 'approved',
  });
}

/**
 * Reject content and remove from queue
 */
export async function rejectContent(contentId: string): Promise<void> {
  await updateCustomTrainingContent(contentId, {
    status: 'rejected',
  });
}

/**
 * Get approved content ready for training rotation
 */
export async function getApprovedContentList(dealershipId: string): Promise<CustomTrainingContent[]> {
  const approved = await getApprovedContent(dealershipId);

  return approved.map((a: Record<string, unknown>) => ({
    id: a.id as string,
    dealershipId: a.dealership_id as string,
    createdBy: a.created_by as string,
    rawInput: a.raw_input as string,
    formattedScenario: a.formatted_scenario as string,
    mode: a.mode as 'roleplay' | 'quiz' | 'objection',
    status: 'approved' as const,
    createdAt: a.created_at as string,
  }));
}

/**
 * Format approval request SMS for manager
 */
export function formatApprovalRequest(content: CustomTrainingContent): string {
  return `📝 Pending Approval

Raw idea: "${content.rawInput}"

Formatted as ${content.mode.toUpperCase()}:
"${content.formattedScenario.substring(0, 100)}..."

Reply APPROVE to use this, REJECT to discard.`;
}

/**
 * Format approval confirmation SMS
 */
export function formatApprovalConfirmation(approved: boolean): string {
  if (approved) {
    return '✅ Content approved! Will be added to training rotation tomorrow.';
  } else {
    return '❌ Content rejected. Not added to rotation.';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGradingRubric(mode: 'roleplay' | 'quiz' | 'objection'): Record<string, unknown> {
  switch (mode) {
    case 'quiz':
      return {
        accuracy: {
          weight: 1.0,
          description: 'Response matches correct answer',
        },
      };

    case 'objection':
      return {
        empathy: {
          weight: 0.3,
          description: 'Acknowledges customer concern',
        },
        relevance: {
          weight: 0.35,
          description: 'Provides relevant counter-argument',
        },
        closing: {
          weight: 0.35,
          description: 'Attempts to advance sale after objection',
        },
      };

    case 'roleplay':
    default:
      return {
        product_knowledge: {
          weight: 0.25,
          description: 'Demonstrates product knowledge',
        },
        customer_rapport: {
          weight: 0.25,
          description: 'Builds connection',
        },
        closing_technique: {
          weight: 0.3,
          description: 'Attempts to close or advance',
        },
        professionalism: {
          weight: 0.2,
          description: 'Maintains professional tone',
        },
      };
  }
}
