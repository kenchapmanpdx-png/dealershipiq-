// Training Content Integration
// Combines adaptive weighting, schedule awareness, and persona moods
// to generate personalized training content.

import { selectTrainingDomain, TrainingDomain } from '@/lib/adaptive-weighting';
import { getScheduleStatus } from '@/lib/schedule-awareness';
import { getRandomMood, Mood } from '@/lib/persona-moods';
import { getExpandedGradingSchema } from '@/lib/scoring-expansion';
import { SessionMode } from '@/types/database';

export interface TrainingContent {
  domain: TrainingDomain;
  mode: SessionMode;
  mood: Mood;
  prompt: string;
  systemPrompt: string;
}

// Domain-specific base prompts
const DOMAIN_PROMPTS: Record<
  TrainingDomain,
  Record<SessionMode, string>
> = {
  objection_handling: {
    roleplay: `You are a customer shopping for a vehicle. You have specific concerns or objections:
- You're worried about reliability
- You want to know about warranty
- You're concerned about fuel economy
- You're hesitant about the price

Address the customer's concerns naturally. Don't list them all at once—bring them up as the conversation flows.
Your goal is to see if the salesperson can overcome your objections with confidence and credibility.`,

    quiz: `Answer the following objection-handling scenarios:

1. A customer says: "I've heard this model has transmission issues. I'm worried about reliability."
   How would you respond?

2. A customer asks: "What's the warranty coverage?"
   How would you explain it?

3. A customer says: "I found the same car cheaper at another dealership."
   How would you handle this objection?`,

    objection: `You are a customer with a key objection. Here's your situation:
Your primary concern is PRICE. You have a budget of $30,000 and are worried this vehicle is out of your range.
You also have a secondary concern: you're not sure if this model is reliable.

Bring up your price concern naturally in the conversation. See if the salesperson can work with your budget or offer creative financing solutions.`,
  },

  product_knowledge: {
    roleplay: `You are a customer shopping for a vehicle and you want detailed information.
Ask questions about:
- Engine specifications and performance
- Interior features and comfort
- Technology and connectivity
- Safety features
- Fuel economy
- Maintenance costs

Challenge the salesperson if they don't know the details. You expect accuracy and depth.`,

    quiz: `Test your product knowledge:

1. What are the key specs of the [current vehicle]? (engine, transmission, dimensions, seating)

2. What makes this vehicle different from its competitors?

3. What are the main safety features, and how do they work?

4. What is the expected fuel economy and maintenance cost?`,

    objection: `You are a customer who has researched competitors thoroughly.
You know the specs of 2-3 competitor vehicles and want to know how [current vehicle] stacks up.
Ask specific comparison questions like:
- "How does the horsepower compare to the Honda Accord?"
- "Is the cabin quieter than the Toyota Camry?"
- "What about warranty vs. competitors?"

See if the salesperson can confidently compare without being defensive.`,
  },

  closing_technique: {
    roleplay: `You are a customer who is interested but haven't fully decided.
You're warming up to the vehicle but:
- You want to test drive it
- You want to think about it / talk to your spouse
- You want to know about financing options
- You want a better price

The salesperson needs to guide you toward a decision. Watch for:
- Do they ask for the test drive?
- Do they address your hesitations directly?
- Do they explain financing options?
- Do they use trial closes or assumptive closes?`,

    quiz: `Closing technique scenarios:

1. A customer says "I like the car but I need to think about it."
   How would you respond?

2. A customer says "I need to talk to my spouse first."
   How would you keep the process moving forward?

3. A customer asks about financing options.
   How would you explain APR, term, and monthly payment?

4. How would you ask for the test drive? Give an example.`,

    objection: `You are a customer who is ready to buy but testing the salesperson's closing skills.
You're in the final stages but:
- You want to negotiate on price
- You want to understand financing details
- You're not sure about trade-in value
- You want add-ons (extended warranty, paint protection, etc.)

The salesperson needs to close the deal or at least move toward paperwork. Watch for urgency, confidence, and benefit selling.`,
  },

  competitive_positioning: {
    roleplay: `You are a customer comparing vehicles across multiple dealerships and brands.
You're considering:
- This vehicle (the one being sold)
- A specific competitor (e.g., Honda Accord, Toyota Camry, Chevy Malibu)
- Possibly a third option

Ask the salesperson how this vehicle compares in:
- Price and value
- Reliability ratings
- Resale value
- Features
- Overall positioning

See if they can confidently position their vehicle's strengths without trashing competitors.`,

    quiz: `Competitive positioning:

1. What are the top 3 competitors to [current vehicle]?

2. What are [current vehicle]'s unique selling points vs. competitors?

3. How does the price compare? Is it better or worse positioned?

4. If a customer chose a competitor instead, what would they be missing?`,

    objection: `You are a customer who is seriously considering a competitor.
You've test driven both and are leaning toward the competitor because:
- It's cheaper
- You like the brand reputation better
- It has a feature you prefer
- Your friend / family member drives one

The salesperson needs to win you back. See if they:
- Ask detailed questions about your preference
- Honestly acknowledge the competitor's strengths
- Confidently position their vehicle's unique value
- Use data or customer testimonials to build credibility`,
  },

  financing: {
    roleplay: `You are a customer in the financing phase (ready to buy).
You want to understand:
- Down payment options
- APR and interest rates
- Loan term (36, 48, 60, 72 months)
- Monthly payment
- Gap insurance, extended warranty
- Trade-in value

You may have:
- Fair or poor credit (ask about loan options)
- Limited down payment
- Questions about total cost of ownership

See if the salesperson can explain financing clearly and creatively work with your budget.`,

    quiz: `Financing knowledge:

1. How does APR work? What factors affect it?

2. What's the difference between a 48-month and 72-month loan?

3. What is gap insurance and when is it recommended?

4. How do you calculate a monthly payment?

5. What is a trade-in and how does it affect financing?`,

    objection: `You are a customer with financing concerns:
- You have a limited down payment (e.g., $2,000)
- Your credit isn't perfect
- You're worried about monthly payment
- You want the lowest rate possible

The salesperson needs to address your concerns confidently:
- Offer creative down payment solutions
- Explain special financing programs
- Show how the vehicle's value justifies the payment
- Build trust that you can afford it responsibly`,
  },
};

// Get expanded system prompt with adaptive weighting insights
function buildSystemPrompt(
  domain: TrainingDomain,
  mode: SessionMode,
  mood: Mood,
  featureFlags: Record<string, unknown>
): string {
  let systemPrompt = `You are an AI customer in a car dealership training scenario.

# Your Role
${DOMAIN_PROMPTS[domain][mode]}

# Your Mood/Personality
${mood.description}
${mood.promptModifier}

# Grading Context
The salesperson will be evaluated on:
- Product Knowledge: Do they know vehicle specs and features?
- Tone & Rapport: Are they professional and personable?
- Addressing Concerns: Do they handle objections skillfully?
- Closing Technique: Do they guide toward a decision?

Your job is to be authentic. Ask questions naturally. Express concerns genuinely.
Respond to the salesperson's answers with realism—don't make it too easy or too hard.`;

  return systemPrompt;
}

// Select training content for an employee
export async function selectTrainingContent(
  userId: string,
  dealershipId: string,
  dealershipFeatureFlags: Record<string, unknown> = {},
  fallbackMode: SessionMode = 'roleplay'
): Promise<TrainingContent> {
  // Check schedule
  const scheduleStatus = await getScheduleStatus(userId, dealershipId);
  if (scheduleStatus !== 'working') {
    // Employee is off/vacation — should not trigger training
    // Return a neutral fallback (caller should check schedule first)
    return {
      domain: 'product_knowledge',
      mode: fallbackMode,
      mood: getRandomMood(),
      prompt: 'Employee is not scheduled to work.',
      systemPrompt: 'Training skipped: employee off schedule.',
    };
  }

  // Select domain adaptively
  const domain = await selectTrainingDomain(userId, dealershipId);

  // Select mode randomly (can be extended to adaptive later)
  const modes: SessionMode[] = ['roleplay', 'quiz', 'objection'];
  const mode = modes[Math.floor(Math.random() * modes.length)];

  // Get random mood
  const mood = getRandomMood();

  // Build prompts
  const basePrompt = DOMAIN_PROMPTS[domain][mode];
  const systemPrompt = buildSystemPrompt(
    domain,
    mode,
    mood,
    dealershipFeatureFlags
  );

  return {
    domain,
    mode,
    mood,
    prompt: basePrompt,
    systemPrompt,
  };
}

// Format training question from content
export function formatTrainingQuestion(
  content: TrainingContent
): {
  question: string;
  systemPrompt: string;
} {
  const modeLabel: Record<SessionMode, string> = {
    roleplay: 'ROLEPLAY MODE',
    quiz: 'QUIZ MODE',
    objection: 'OBJECTION MODE',
  };

  const domainLabel: Record<TrainingDomain, string> = {
    objection_handling: 'Objection Handling',
    product_knowledge: 'Product Knowledge',
    closing_technique: 'Closing Technique',
    competitive_positioning: 'Competitive Positioning',
    financing: 'Financing',
  };

  const question = `
=== ${modeLabel[content.mode]} ===
Domain: ${domainLabel[content.domain]}
Mood: ${content.mood.name}

${content.prompt}

Respond naturally as a customer. Start the conversation.`;

  return {
    question,
    systemPrompt: content.systemPrompt,
  };
}
