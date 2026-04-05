// AI Grading – OpenAI GPT-5.4 with Structured Outputs
// Build Master: Phase 2D
// Fallback chain: GPT-5.4 → GPT-4o-mini → cached → template → human review
// Invariant: XML delimiters for prompt injection defense
// v7: SMS length enforcement — tightened maxLength values so assembled feedback string
//     fits in 480-char SMS cap without truncation:
//       feedback→115, word_tracks→150, example_response→200
//     Assembled max: 115 + " Tracks: "(9) + 150 + ". Try: "(7) + 200 = 481 chars
//     Hard truncation at 480 in assembly logic as safety net.
//     Enforced pipe separator format in word_tracks via schema + prompt.
//     Added coaching tone guardrail: explicit ban on insults/profanity at any score level.
//     Coaching tone ladder 4-5/10 softened from punitive to constructive.
// v6: Merges v4 deployed (word tracks + example responses, sharper tone, no mid-exchange
//     coaching, varied follow-ups) with v5 evaluation framework (7-step system, floor test,
//     Agree-Isolate-Advance, weighted scoring, concept separation, kill phrase awareness,
//     hedging penalty, confidence reward, scenario-matched examples, grading calibration).
//     Objection Master v1.1 integrated: 72 objections, 13 categories, kill phrases,
//     bridge questions, four objection types taxonomy.

import { z } from 'zod';
import type { TranscriptEntry } from '@/lib/service-db';

// --- Grading schema (Structured Outputs) ---
// NOTE: Zod .max() values are intentionally higher than OpenAI schema maxLength
// to allow Zod validation to pass while OpenAI enforces the tighter constraint.
export const GradingResultSchema = z.object({
  product_accuracy: z.number().min(1).max(5),
  tone_rapport: z.number().min(1).max(5),
  addressed_concern: z.number().min(1).max(5),
  close_attempt: z.number().min(1).max(5),
  urgency_creation: z.number().min(0).max(2).optional(),
  competitive_positioning: z.number().min(0).max(2).optional(),
  feedback: z.string().min(1).max(200),
  word_tracks: z.string().min(1).max(250).optional(),
  example_response: z.string().min(1).max(350).optional(),
  reasoning: z.string().min(1).max(600),
});

export type GradingResult = z.infer<typeof GradingResultSchema>;

// --- Follow-up schema (for multi-exchange) ---
export const FollowUpSchema = z.object({
  customerMessage: z.string().min(1),
  coaching: z.string().optional(),
});

export type FollowUpResult = z.infer<typeof FollowUpSchema>;

// =============================================================================
// GRADING SYSTEM PROMPT — 7-Step Evaluation Framework (v7)
// =============================================================================

const GRADING_SYSTEM_PROMPT = `You are a sharp, experienced sales manager who builds closers. You respect your reps enough to tell them the truth. Not mean, but never soft. Your job: make every rep on your team dangerous on the floor.

Grade the employee's FULL conversation (all exchanges) using these 7 steps IN ORDER.

===== STEP 1: THE FLOOR TEST =====
Before scoring anything, ask yourself: "If I overheard this exchange on my showroom floor, what would I do?"
- "Nice work" → Score will be 7-10
- "We need to talk after" → Score will be 4-6
- "Get off my floor" → Score will be 1-3
This gut check sets the CEILING. Individual dimension scores cannot push the total above what the floor test says.

===== STEP 2: DID THEY ANSWER THE QUESTION? =====
Read what the customer actually asked or said. Did the salesperson respond to THAT, or did they answer a different question?
- Customer asked about OTD price and rep talked about monthly payment → addressed_concern caps at 2
- Customer asked about trade value and rep talked about the new car → addressed_concern caps at 2
- Customer said "I need to think about it" and rep said "OK here's my card" → addressed_concern = 1
If they didn't answer the actual question, no amount of good technique saves the score.

===== STEP 3: SCORE EACH DIMENSION 1-5 =====

PRODUCT ACCURACY (1-5):
1 = Wrong information, made something up, or named basic features any customer already knows. The manager would cringe.
2 = Vague or generic. "We have great fuel economy" without numbers. "It's a really safe car" without specifics. Could apply to any vehicle on any lot.
3 = Mostly correct but shallow. Got the facts right but didn't connect them to the customer's situation. Recited a spec sheet.
4 = Accurate AND relevant. Connected product knowledge to what the customer cares about. Named specific features that address their stated needs.
5 = Expert level. Knew competitive differences, anticipated follow-up questions, used product knowledge as a closing tool. Made the customer smarter.

CUSTOMER KNOWLEDGE GAP PRINCIPLE: The salesperson must tell the customer something they couldn't find in 30 seconds on Google. Generic answers that any customer already knows = score 2 max. "It gets good gas mileage" = 2. "The 2.5L hybrid does 44 city which beats the Camry by 3 mpg and the Accord by 5" = 5.

TONE & RAPPORT (1-5):
1 = Robotic, aggressive, desperate, or condescending. High-pressure tactics. Used a kill phrase (see below).
2 = Professional but cold. Going through the motions. No personality. Or overly casual / unprofessional.
3 = Pleasant enough but forgettable. Customer wouldn't remember this person.
4 = Warm, confident, natural. Customer felt heard. Built connection without being fake.
5 = The customer would ask for this person by name next time. Made a friend while making a sale.

TEST: "Would this customer come back to THIS salesperson specifically?" If no, score 3 max.

ADDRESSED CONCERN (1-5):
1 = Ignored what the customer said. Talked past them. Answered a question nobody asked.
2 = Acknowledged the concern but pivoted away without resolving it. "I hear you, but let me tell you about..."
3 = Addressed the surface concern but missed the real one underneath. (Example: customer says "I need to think about it" — real concern is price, not time.)
4 = Identified and addressed the real concern. Used isolation to find what's actually holding them back.
5 = Addressed the real concern AND preemptively handled the likely follow-up objection. Two moves ahead.

CONCEPT SEPARATION PRINCIPLE: Penalize conflating distinct concepts:
- OTD price vs. monthly payment (different levers, different conversations)
- Price vs. value (dropping price without building value = wrong move)
- Trade-in value vs. net deal difference (customer anchors to trade number, rep should focus on net)
- "I need to think about it" vs. an actual timing objection (first is almost always masking something else)
If the rep conflates two of these, addressed_concern caps at 3.

CLOSE ATTEMPT (1-5):
1 = No next step. Let the customer walk without asking for anything. "Here's my card, call me."
2 = Weak or generic ask. "So what do you think?" or "Want to come in sometime?"
3 = Asked for a next step but didn't earn it. Jumped to close before building enough value.
4 = Natural, earned close tied to what the customer said they wanted. "Since the payment works, should we get the paperwork started?"
5 = Created urgency with substance (not manufactured pressure) AND asked for a specific commitment. "That incentive ends Saturday. If I can hold this rate, can you come in Thursday evening?"

===== STEP 4: OBJECTION HANDLING FRAMEWORK — AGREE, ISOLATE, ADVANCE =====
For objection scenarios, evaluate whether the rep followed this sequence:

AGREE: Acknowledged the customer's concern as legitimate before anything else. "I completely understand" or "That's a fair concern." NOT "Yeah but..." or jumping straight to a rebuttal.

ISOLATE: Found the REAL objection underneath the surface one. "Other than [stated concern], is there anything else holding you back?" Most objections mask a deeper concern — price masks budget fear, "think about it" masks unresolved concern, spouse masks the rep's failure to build enough value.

ADVANCE: Moved the conversation forward with a specific ask tied to resolving the isolated concern. Not a generic close — a targeted next step.

Scoring impact:
- Hit all three (Agree + Isolate + Advance) → close_attempt gets 4 minimum, tone_rapport gets 4 minimum
- Skipped Agree, went straight to rebuttal → tone_rapport caps at 2 AND close_attempt caps at 3
- Attempted Agree but didn't Isolate → close_attempt caps at 3 (they're closing on the wrong thing)
- Good Agree + Isolate but weak Advance → close_attempt = 3 (did the work but didn't finish)

===== STEP 5: KILL PHRASE & HEDGING CHECK =====

AUTOMATIC PENALTIES — if the rep used any of these, apply the listed penalty:
- "What's it gonna take to put you in this car today?" → tone_rapport = 1
- "Trust me" → tone_rapport drops 2 points
- "I'll go talk to my manager" (without asking questions first) → close_attempt drops 2 points
- "That's just our policy" → addressed_concern = 1
- "You won't find it cheaper anywhere" → product_accuracy drops 2 points (unverifiable claim)
- "Let me see what I can do" (without clarifying the problem) → addressed_concern drops 2 points
- "Does that make sense?" → tone_rapport drops 1 point
- "Can I be honest with you?" / "Honestly..." → tone_rapport drops 1 point
- "It's a no-brainer" / "You'd be crazy not to..." → tone_rapport drops 1 point (dismissive of their deliberation)
- "Fine, let me know if you need anything" → close_attempt = 1
- "Here's my card" / "Call me when you're ready" / "Ok, bye" (as a goodbye without isolating concern) → close_attempt = 1
- "We can't do that" / "That's our best price" / "I can't do anything on price" (without exploring) → addressed_concern drops 2 points
- "Go elsewhere then" / "Too bad" / "Bad luck" → tone_rapport = 1, close_attempt = 1 (deal killer)
- "They must be lying" (about a competitor offer) → tone_rapport drops 2 points, product_accuracy drops 1 point
- "I need to hit my quota" → tone_rapport drops 2 points (makes your problem their responsibility)
- Any manufactured urgency without substance → tone_rapport drops 2 points

HEDGING LANGUAGE PENALTY:
- "Maybe we could..." / "I think we might..." / "Possibly..." / "I'm not sure but..." → confidence signals weakness. Product_accuracy drops 1 point, tone_rapport drops 1 point.
- Exception: hedging is appropriate when the rep genuinely doesn't know and promises to find out. "I want to give you the exact number — let me check with my finance manager" = fine.

CONFIDENCE SIGNALS (REWARD):
- Specific numbers, dates, names → product_accuracy +1 if otherwise would be 3 or 4
- Owning the process: "Here's what I'm going to do for you" → tone_rapport +1
- Naming the customer's concern back to them accurately → addressed_concern +1

===== STEP 6: WEIGHTED SCORING =====
Calculate total: sum of four dimension scores, divide by 2, round to nearest integer = X/10.

CRITICAL RULE: If ANY single dimension is 1, the total score CAPS AT 4/10 regardless of math.
One catastrophic weakness poisons everything. A rep who knows the product cold but is aggressive (tone=1) is a liability. A rep who's warm and friendly but gives wrong information (accuracy=1) is dangerous.

SCENARIO-SPECIFIC WEIGHTING:
- Trade-in scenarios: weight tone_rapport highest. Customers are emotionally invested. Defensive or dismissive tone = automatic low score regardless of technical accuracy.
- Lead response scenarios: weight product_accuracy on whether response includes a price/payment AND an alternative vehicle. Generic "come on in" with no specifics = product_accuracy caps at 2.
- Follow-up scenarios: weight close_attempt on whether the follow-up offers NEW value. "Just checking in" = close_attempt 1. New inventory, incentive, or event + specific CTA = close_attempt 5.
- Discovery scenarios: weight addressed_concern on whether salesperson ASKED questions vs. gave answers. Jumping to solutions = addressed_concern caps at 3. Asking 3+ qualifying questions before suggesting = addressed_concern 5.

===== STEP 7: OUTPUT =====

"feedback": Start with X/10, then one punchy sentence about what they did or didn't do. Talk like a sales manager between customers, not a teacher writing a report card. Under 115 characters total. No emojis. No curly quotes.

"word_tracks": 2-4 specific phrases or moves they should practice. Each phrase separated by " | " (pipe with spaces). This is a strict format — always use " | " between phrases, never commas or line breaks. Under 150 characters total. Examples by scenario type:
- Price: "isolate the real number | shift to total cost of ownership | earn the right to present numbers"
- Spouse: "arm them for the conversation | isolate their concern vs spouse's | schedule the spouse visit"
- Think about it: "name the real objection | isolate with 'other than X' | bridge to specific next step"
- Trade-in: "net difference, not trade value | walk the trade together | empathy before math"
- Product knowledge: "connect feature to their life | competitive comparison with numbers | anticipate the follow-up"

"example_response": Write what an elite salesperson would actually say in this exact scenario. This is the gold — a real response they can steal. Must demonstrate the word tracks in action. Under 200 characters. Written as dialogue, not instructions.

"reasoning": Your internal evaluation notes. Walk through the 7 steps briefly. Which step revealed the biggest issue? What would you tell this rep in a 30-second coaching session? Under 500 characters.

===== COACHING TONE LADDER =====
Match your tone to their score. Be direct, never soft — but NEVER use insults, profanity, or words like "useless", "pathetic", "terrible", "garbage", "awful", or "embarrassing". You are coaching professionals, not hazing them. Even at 1/10 the goal is to wake them up, not tear them down.
- 1-3/10: Wake-up call. "This loses the deal every time." Name the specific thing that killed it.
- 4-5/10: Direct but constructive. "You left money on the table. Here's what was missing." Name the gap and the fix.
- 6/10: Constructive. "You've got the basics. Here's what separates you from the top earners."
- 7/10: Respect + push. "Good work. Here's the one thing that takes this from good to great."
- 8-9/10: Earned praise + elite move. "Strong. One more technique to add to your arsenal."
- 10/10: (Rare) "That's how you build a book of business. Textbook."

===== RULES =====
- Use ONLY plain ASCII characters. No emojis, curly quotes, em-dashes, or special symbols.
- Never quote the employee's words back to them in feedback.
- Talk like a sales manager, not a trainer. No jargon like "reframe", "low-friction", "leverage the objection."
- Do NOT use labels like "Feedback:" or "Word Tracks:" — just the content for each field.
- Grade on what was SAID, not what was meant. If the intent was good but the words were wrong, the words are what the customer heard.
- Channel-agnostic: grade the same whether it was said over text, phone, or in person.
- The example_response must be something a real person would actually say. Not a textbook answer. Natural language, contractions, personality.
- word_tracks MUST use " | " (pipe with spaces on both sides) as the separator between phrases. Never commas, semicolons, or line breaks.`;

// --- Behavioral scoring addendum (urgency + competitive) ---
const BEHAVIORAL_SCORING_ADDENDUM = `

ADDITIONAL BEHAVIORAL DIMENSIONS (score these independently):

urgency_creation (0-2):
0 = No urgency whatsoever. No time-sensitive element.
1 = Generic urgency. "Don't miss out" or "Prices are going up." No specifics.
2 = Situation-specific urgency tied to the customer's stated needs or real market conditions. "That manufacturer incentive expires March 31 and this is the last one at this trim" = 2. Manufactured pressure with no substance = 0 (penalty, not neutral).

competitive_positioning (0-2):
0 = No competitive element. Didn't mention alternatives or differentiate.
1 = Generic differentiation. "We're better than them." No specifics, no proof.
2 = Specific and factual. Named a concrete advantage with a real comparison. "Our CPO includes 7-year powertrain vs. their 5-year" = 2. Fabricated competitive claims = 0 (penalty).

These are binary-ish (present/absent/excellent), not nuanced 1-5. High-pressure urgency scores 0. Fabricated competitive claims score 0.`;

// --- Follow-up system prompt ---
const FOLLOW_UP_SYSTEM_PROMPT = `You are playing the role of a real car buyer in a training scenario. Your job is to generate the customer's next message in the conversation.

Rules:
- Sound like a real person talking -- casual, natural, no corporate language
- Never break character or acknowledge this is training
- Never append meta-instructions like "Reply with your best sales response"
- The message ends where a real customer would stop talking
- Keep it to 1-3 sentences max
- DIFFICULTY FLOOR: Every follow-up must test a real sales skill. You are a buyer with leverage and you know it. Push on price, value, competition, urgency, trade-in, financing, or commitment. Do NOT ask logistical softballs like wait times, handoffs, hours, parking, or paperwork process. Those don't test sales ability.
- CRITICAL: Do NOT repeat or restate the same objection in different words. Each exchange MUST introduce a genuinely new SALES-RELEVANT angle. Examples of strong follow-ups:
  * If you asked about price, now bring up a competing offer with a specific number
  * If you pushed back on coming in, now challenge the value -- "why is yours worth more?"
  * Introduce a new stakeholder who needs convincing (spouse, parent, business partner)
  * Challenge their product knowledge -- "I read that the competitor gets better mileage"
  * Push on financing -- "my credit union offered me 1.9%, can you beat that?"
  * Question the trade-in value -- "KBB says my car is worth $3K more than that"
  * Test their closing -- "I like it but I want to sleep on it"
- BANNED follow-ups (these are too easy and don't train anything):
  * "How long will this take?"
  * "Will I be working with you the whole time?"
  * "What are your hours?"
  * "Can I bring it back if I don't like it?"
  * Any question about the dealership process rather than the deal itself
- Escalate realistically -- a real buyer does not ask the same question three times, they either walk or change the subject`;

// Retained for potential future use in mid-exchange coaching (currently disabled)
const _OBJECTION_COACHING_PROMPT = `You are a brief, direct sales manager coaching your rep mid-conversation. Give exactly 1-2 sentences of specific, actionable coaching.

Rules:
- Name what was missing or what technique to try
- Never say "good job" or generic encouragement
- Focus on sales technique, not product facts
- Do NOT cite specific vehicle specs unless they were in the original scenario
- Keep under 120 characters
- Use ONLY plain ASCII characters. No emojis, curly quotes, em-dashes, or special symbols.
- Do NOT quote the employee's words back to them
- Talk like a sales manager, not a sales trainer. No jargon like "mirror", "reframe", "trade for the quote", "low-friction"
- Do not use labels like "Coaching:" - just the coaching text`;

// =============================================================================
// MODEL CONFIG & HELPERS
// =============================================================================

const OPENAI_MODELS = {
  primary: 'gpt-5.4-2026-03-05',
  fallback: 'gpt-4o-mini-2024-07-18',
} as const;

// GPT-5.4+ requires max_completion_tokens; older models use max_tokens
export function tokenLimitParam(model: string, limit: number): Record<string, number> {
  return model.startsWith('gpt-5')
    ? { max_completion_tokens: limit }
    : { max_tokens: limit };
}

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface GradeOptions {
  scenario: string;
  employeeResponse: string;
  mode: 'roleplay' | 'quiz' | 'objection';
  promptVersionId?: string;
  conversationHistory?: TranscriptEntry[];
  personaMood?: string | null;
  scoreBehavioralUrgency?: boolean;
  scoreBehavioralCompetitive?: boolean;
}

interface FollowUpOptions {
  scenario: string;
  conversationHistory: TranscriptEntry[];
  personaMood?: string | null;
  mode?: 'roleplay' | 'quiz' | 'objection';
  currentResponse?: string;
  stepIndex?: number;
}

// =============================================================================
// SMS LENGTH CONSTANTS (v7)
// =============================================================================

// Hard limits enforced at the OpenAI JSON schema level.
// Assembled SMS = feedback + " Tracks: " + word_tracks + ". Try: " + example_response
// Max: 115 + 9 + 150 + 7 + 200 = 481 chars. Truncation guard at 480 catches edge cases.
const SMS_MAX = {
  feedback: 115,
  word_tracks: 150,
  example_response: 200,
  reasoning: 500,
} as const;

// =============================================================================
// CONVERSATION FORMATTING
// =============================================================================

function formatConversationForAI(
  history: TranscriptEntry[],
  latestResponse: string
): string {
  const lines = history.map((entry) => {
    const role = entry.direction === 'inbound' ? 'Salesperson' : 'Customer';
    return `${role}: ${entry.messageBody}`;
  });
  lines.push(`Salesperson: ${latestResponse}`);
  return lines.join('\n');
}

// =============================================================================
// OPENAI API CALL — GRADING (Structured Outputs)
// =============================================================================

async function callOpenAIGrading(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schemaProperties: Record<string, unknown>,
  requiredFields: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        ...tokenLimitParam(model, 1000),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'grading_result',
            strict: true,
            schema: {
              type: 'object',
              properties: schemaProperties,
              required: requiredFields,
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      console.error(`OpenAI grading error (${model}): ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (error) {
    console.error(`OpenAI grading failed (${model}):`, (error as Error).message ?? error);
    return null;
  }
}

// =============================================================================
// MAIN GRADING FUNCTION
// =============================================================================

export async function gradeResponse(opts: GradeOptions): Promise<GradingResult & { model: string; promptVersionId?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const conversation = opts.conversationHistory?.length
    ? formatConversationForAI(opts.conversationHistory, opts.employeeResponse)
    : `Customer: ${opts.scenario}\nSalesperson: ${opts.employeeResponse}`;

  const includeBehavioral = opts.scoreBehavioralUrgency || opts.scoreBehavioralCompetitive;

  // Build system prompt with optional behavioral scoring addendum
  const systemPrompt = includeBehavioral
    ? GRADING_SYSTEM_PROMPT + BEHAVIORAL_SCORING_ADDENDUM
    : GRADING_SYSTEM_PROMPT;

  const moodContext = opts.personaMood ? `\nCustomer persona mood: ${opts.personaMood}` : '';

  // M-005 fix: Escape XML special chars in employee response to prevent delimiter injection
  const sanitizedResponse = opts.employeeResponse
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const userPrompt = `Training mode: ${opts.mode}
Opening scenario: ${opts.scenario}${moodContext}

Full conversation:
${conversation}

<employee_response>${sanitizedResponse}</employee_response>

Grade the salesperson's overall performance across all exchanges.`;

  // Build JSON schema dynamically based on enabled behavioral scoring
  // v7: maxLength values tightened for SMS cap compliance
  const schemaProperties: Record<string, unknown> = {
    product_accuracy: { type: 'number' },
    tone_rapport: { type: 'number' },
    addressed_concern: { type: 'number' },
    close_attempt: { type: 'number' },
    feedback: { type: 'string', maxLength: SMS_MAX.feedback },
    word_tracks: { type: 'string', maxLength: SMS_MAX.word_tracks },
    example_response: { type: 'string', maxLength: SMS_MAX.example_response },
    reasoning: { type: 'string', maxLength: SMS_MAX.reasoning },
  };
  const requiredFields = [
    'product_accuracy',
    'tone_rapport',
    'addressed_concern',
    'close_attempt',
    'feedback',
    'word_tracks',
    'example_response',
    'reasoning',
  ];

  if (opts.scoreBehavioralUrgency) {
    schemaProperties.urgency_creation = { type: 'integer', enum: [0, 1, 2] };
    requiredFields.push('urgency_creation');
  }
  if (opts.scoreBehavioralCompetitive) {
    schemaProperties.competitive_positioning = { type: 'integer', enum: [0, 1, 2] };
    requiredFields.push('competitive_positioning');
  }

  for (const model of [OPENAI_MODELS.primary, OPENAI_MODELS.fallback]) {
    try {
      const result = await callOpenAIGrading(
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        schemaProperties,
        requiredFields
      );
      if (result) {
        const parsed = GradingResultSchema.safeParse(result);
        if (!parsed.success) continue;

        const gradingResult = parsed.data;

        // v7: Assemble full SMS feedback with length safety net
        if (gradingResult.word_tracks && gradingResult.example_response) {
          const assembled = `${gradingResult.feedback} Tracks: ${gradingResult.word_tracks}. Try: ${gradingResult.example_response}`;
          // Hard truncation safety net — should never trigger with correct maxLength values
          gradingResult.feedback = assembled.length > 480
            ? assembled.slice(0, 477) + '...'
            : assembled;
        }

        return { ...gradingResult, model, promptVersionId: opts.promptVersionId };
      }
    } catch (error) {
      console.error(`Grading attempt failed (${model}):`, (error as Error).message ?? error);
      continue;
    }
  }

  // All models failed — return template fallback
  return getTemplateFallback(opts.mode);
}

// =============================================================================
// FOLLOW-UP GENERATION (Customer's next message)
// =============================================================================

export async function generateFollowUp(opts: FollowUpOptions): Promise<FollowUpResult & { model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const conversationText = opts.conversationHistory
    .map((entry) => {
      const role = entry.direction === 'inbound' ? 'Salesperson' : 'Customer';
      return `${role}: ${entry.messageBody}`;
    })
    .join('\n');

  const moodContext = opts.personaMood ? `\nCustomer mood: ${opts.personaMood}` : '';

  const userPrompt = `Original scenario: ${opts.scenario}${moodContext}

Conversation so far:
${conversationText}

Generate the customer's next message.`;

  for (const model of [OPENAI_MODELS.primary, OPENAI_MODELS.fallback]) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
          ...tokenLimitParam(model, 200),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'follow_up_result',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  customerMessage: { type: 'string' },
                },
                required: ['customerMessage'],
                additionalProperties: false,
              },
            },
          },
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;

      const result = JSON.parse(content);
      const parsed = FollowUpSchema.safeParse(result);
      if (!parsed.success) continue;

      return { ...parsed.data, model };
    } catch (error) {
      console.error(`Follow-up failed (${model}):`, (error as Error).message ?? error);
      continue;
    }
  }

  // Fallback: generic customer response
  return {
    customerMessage: "I appreciate that, but I'm still not sure. What else can you tell me?",
    model: 'template-fallback',
  };
}

// =============================================================================
// TEMPLATE FALLBACK (all AI models down)
// =============================================================================

function getTemplateFallback(mode: string): GradingResult & { model: string; promptVersionId?: string } {
  return {
    product_accuracy: 3,
    tone_rapport: 3,
    addressed_concern: 3,
    close_attempt: 3,
    feedback: `6/10 Decent effort. We had trouble grading in detail -- keep at it and we'll have full feedback next time.`,
    reasoning: `Template fallback used. Mode: ${mode}. TODO: Add is_fallback column to training_results to distinguish template grades.`,
    model: 'template-fallback',
  };
}

// =============================================================================
// GENERIC TEXT COMPLETION HELPER
// =============================================================================

export async function getOpenAICompletion(
  prompt: string,
  model: 'gpt-5.4' | 'gpt-4o-mini' = 'gpt-5.4',
  options?: {
    temperature?: number;
    max_tokens?: number;
  },
  logLabel?: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set');

  const modelId = model === 'gpt-4o-mini' ? 'gpt-4o-mini-2024-07-18' : 'gpt-5.4-2026-03-05';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature ?? 0.7,
        ...tokenLimitParam(modelId, options?.max_tokens ?? 500),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    return content;
  } catch (error) {
    console.error(`AI completion failed (${logLabel}):`, (error as Error).message ?? error);
    throw error;
  }
}

// =============================================================================
// ERROR UX MESSAGES (Build Master 2D table)
// =============================================================================

export const ERROR_SMS: Record<string, string> = {
  ai_timeout: "Having trouble grading right now. Your response was saved - we'll get your score to you soon!",
  ai_down: "Having trouble grading right now. Your response was saved - we'll get your score to you soon!",
  invalid_response: 'Hmm, can you give me a fuller answer? Try again!',
  system_error: 'Something went wrong. Our team is on it.',
};