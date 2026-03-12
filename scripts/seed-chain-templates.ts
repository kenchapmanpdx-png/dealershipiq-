/**
 * Seed script: chain_templates for Phase 6C Scenario Chains
 * 9 templates: 3 domains (objection_handling, product_knowledge, closing_technique) × 3 difficulties
 *
 * Run: npx tsx scripts/seed-chain-templates.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env (or .env.local)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

interface StepPrompt {
  step: number;
  base_prompt?: string;
  persona?: { mood: string; situation: string };
  branches?: Record<string, { prompt: string; persona: { mood: string; situation: string } }>;
  branch_rules?: Record<string, string>;
}

interface TemplateRow {
  name: string;
  description: string;
  total_steps: number;
  step_prompts: StepPrompt[];
  difficulty: 'easy' | 'medium' | 'hard';
  taxonomy_domains: string[];
  vehicle_required: boolean;
}

const templates: TemplateRow[] = [
  // ═══════════════════════════════════════════════════════════════
  // OBJECTION HANDLING — Easy
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Price Objection — Warm Lead',
    description: 'Customer likes the vehicle but pushes back on price. 3-day arc from initial concern through competitor comparison to close.',
    total_steps: 3,
    difficulty: 'easy',
    taxonomy_domains: ['objection_handling'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}, a friendly customer interested in a {vehicle}. You like the car but say: "I was really hoping to stay under $30k. Is there any wiggle room on the price?" Be warm but firm about your budget.',
        persona: { mood: 'friendly', situation: 'first visit, budget concern' },
      },
      {
        step: 2,
        branches: {
          weak_acknowledge: {
            prompt: 'You are {customer_name} again. You did some research and found a {competitor_vehicle} for less. Say: "I found a similar car at another dealer for $2,000 less. Can you match that?" You are still friendly but now have leverage.',
            persona: { mood: 'confident', situation: 'has competitor quote' },
          },
          default: {
            prompt: 'You are {customer_name} returning. Say: "I thought about it and I really do want the {vehicle}, but my spouse says we need to stay under budget. Any way to make this work?" You are warm and motivated but constrained.',
            persona: { mood: 'hopeful', situation: 'spouse budget constraint' },
          },
        },
        branch_rules: {
          weak_acknowledge: 'empathy < 3.0',
        },
      },
      {
        step: 3,
        branches: {
          still_resistant: {
            prompt: 'You are {customer_name} on day 3. Say: "Look, I want to buy today but I need to feel like I am getting a fair deal. What is the absolute best you can do?" You are ready to buy if the salesperson makes you feel valued.',
            persona: { mood: 'decisive', situation: 'ready to buy if treated right' },
          },
          default: {
            prompt: 'You are {customer_name} coming back to finalize. Say: "OK, I have been thinking about everything you said. I am ready to move forward if we can agree on numbers today." You are positive and ready.',
            persona: { mood: 'positive', situation: 'ready to close' },
          },
        },
        branch_rules: {
          still_resistant: 'close_attempt < 2.5',
        },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // OBJECTION HANDLING — Medium
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Trade-In Dispute',
    description: 'Customer disagrees with trade-in value. Escalates from disappointment through KBB comparison to potential walkout.',
    total_steps: 3,
    difficulty: 'medium',
    taxonomy_domains: ['objection_handling'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}, trading in your 2020 Honda Accord for a {vehicle}. The dealer offered $15,000 but you expected $18,000. Say: "That trade-in number is way lower than I expected. KBB says my car is worth at least $17,500." Be disappointed but willing to discuss.',
        persona: { mood: 'disappointed', situation: 'trade-in value dispute' },
      },
      {
        step: 2,
        branches: {
          escalate: {
            prompt: 'You are {customer_name} again. You are now frustrated. Say: "I showed your offer to my mechanic and he laughed. He said my Accord is in excellent condition. I feel like you are lowballing me." Be visibly upset.',
            persona: { mood: 'frustrated', situation: 'feels disrespected by offer' },
          },
          default: {
            prompt: 'You are {customer_name}. You did more research. Say: "I checked Carvana and they offered $16,800 sight unseen. I would rather buy from you but I need the numbers to make sense." You are factual, not emotional.',
            persona: { mood: 'firm', situation: 'has competing offer' },
          },
        },
        branch_rules: {
          escalate: 'empathy < 2.5',
        },
      },
      {
        step: 3,
        branches: {
          walkout: {
            prompt: 'You are {customer_name}. You are about to leave. Say: "I appreciate your time but I think I need to look elsewhere. Unless you can get closer to $17,000 on the trade, I just cannot make the numbers work." Stand up as if to go.',
            persona: { mood: 'resigned', situation: 'walking out' },
          },
          default: {
            prompt: 'You are {customer_name}. Say: "If you can get to $16,500 on the trade, I will sign today. That is $1,500 less than KBB but I understand dealer margins. Can we meet in the middle?" Be reasonable and ready.',
            persona: { mood: 'reasonable', situation: 'compromise offer' },
          },
        },
        branch_rules: {
          walkout: 'close_attempt < 2.0',
        },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // OBJECTION HANDLING — Hard
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Hostile Buyer — Payment Shock',
    description: 'Aggressive customer with payment shock. Accuses dealer of bait-and-switch. Tests de-escalation and financial reframing.',
    total_steps: 3,
    difficulty: 'hard',
    taxonomy_domains: ['objection_handling'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}. You saw an online price of $35,000 for a {vehicle} but in the finance office the monthly payment came out to $750. You expected $500. Say: "Hold on, how is this $750 a month? Your website said $35,000. This feels like a bait and switch." Be angry and suspicious.',
        persona: { mood: 'angry', situation: 'payment shock in F&I' },
      },
      {
        step: 2,
        branches: {
          rage: {
            prompt: 'You are {customer_name}. The explanation did not help. Say: "I have been here four hours and now you are telling me the real price is different? I should have gone to CarMax. At least they are honest." Be openly hostile and mention leaving.',
            persona: { mood: 'hostile', situation: 'threatening to leave for CarMax' },
          },
          default: {
            prompt: 'You are {customer_name}. You calmed down slightly. Say: "OK, walk me through exactly why the payment is that high. Is it the rate? The term? What can we adjust to get closer to $550?" You are still frustrated but listening.',
            persona: { mood: 'frustrated but listening', situation: 'wants breakdown' },
          },
        },
        branch_rules: {
          rage: 'empathy < 2.0',
        },
      },
      {
        step: 3,
        branches: {
          final_threat: {
            prompt: 'You are {customer_name}. Last chance. Say: "I am going to be straight with you. I have the CarMax app open on my phone right now. Give me one reason to stay." You mean it — you will walk unless the salesperson connects with you personally.',
            persona: { mood: 'dead serious', situation: 'phone in hand, ready to leave' },
          },
          default: {
            prompt: 'You are {customer_name}. Say: "Alright, if you can get the payment to $600 or show me a trim level that fits my budget, I will seriously consider it. But no more surprises." You are tough but open to solutions.',
            persona: { mood: 'tough but open', situation: 'willing to negotiate terms' },
          },
        },
        branch_rules: {
          final_threat: 'empathy < 2.5',
        },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // PRODUCT KNOWLEDGE — Easy
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Feature Walkthrough — First-Time Buyer',
    description: 'Young first-time buyer needs education on safety and tech features. Tests ability to explain without overwhelming.',
    total_steps: 3,
    difficulty: 'easy',
    taxonomy_domains: ['product_knowledge'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}, a 23-year-old buying your first new car. Looking at a {vehicle}. Say: "This is my first time buying a car and there are so many features I do not understand. What does the safety package actually include?" Be genuinely curious and a little overwhelmed.',
        persona: { mood: 'curious', situation: 'first-time buyer, needs education' },
      },
      {
        step: 2,
        branches: {
          confused: {
            prompt: 'You are {customer_name}. The explanation was too technical. Say: "I still do not really understand the difference between adaptive cruise control and regular cruise control. Can you explain it more simply?" Look confused.',
            persona: { mood: 'confused', situation: 'needs simpler explanation' },
          },
          default: {
            prompt: 'You are {customer_name}. You understood the safety features. Now ask: "That makes sense. What about the infotainment system? Does it work with my iPhone? I use Apple Maps for everything." Be engaged and interested.',
            persona: { mood: 'engaged', situation: 'moving to tech features' },
          },
        },
        branch_rules: {
          confused: 'product_knowledge < 3.0',
        },
      },
      {
        step: 3,
        base_prompt: 'You are {customer_name}. Wrapping up. Say: "OK so between this {vehicle} and the {competitor_vehicle} my friend recommended, what would you say makes this one worth it for someone like me who is going to be commuting about 45 minutes each way?" Make them sell the value.',
        persona: { mood: 'evaluating', situation: 'comparing against friend recommendation' },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // PRODUCT KNOWLEDGE — Medium
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'EV vs Hybrid Deep Dive',
    description: 'Tech-savvy customer comparing EV and hybrid options. Tests technical depth on powertrains, charging, and TCO.',
    total_steps: 3,
    difficulty: 'medium',
    taxonomy_domains: ['product_knowledge'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}, a tech-savvy engineer. Looking at the {vehicle}. Say: "I have been researching EVs and hybrids for months. What is the real-world range you are seeing, not the EPA number? And how fast is the Level 2 charging?" Be knowledgeable and test the salesperson.',
        persona: { mood: 'analytical', situation: 'testing salesperson knowledge' },
      },
      {
        step: 2,
        branches: {
          caught_off_guard: {
            prompt: 'You are {customer_name}. The answers were vague. Say: "You quoted EPA numbers. I asked about real-world range. What about in cold weather? And what is the battery warranty versus the drivetrain warranty?" Push harder on specifics.',
            persona: { mood: 'skeptical', situation: 'caught vague answers' },
          },
          default: {
            prompt: 'You are {customer_name}. Good answers so far. Say: "Impressive. Now let us talk total cost of ownership over 5 years. Factor in gas savings, maintenance differences, and the federal tax credit. How does the {vehicle} compare to the {competitor_vehicle}?" Go deeper.',
            persona: { mood: 'impressed', situation: 'wants TCO analysis' },
          },
        },
        branch_rules: {
          caught_off_guard: 'product_knowledge < 3.0',
        },
      },
      {
        step: 3,
        base_prompt: 'You are {customer_name}. Final question. Say: "Last thing — I have a 240V outlet in my garage already. Walk me through the home charging setup. Do I need a separate charger or does the car come with one? And what about software updates, are those OTA?" Close on practical details.',
        persona: { mood: 'ready to decide', situation: 'practical setup questions' },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // PRODUCT KNOWLEDGE — Hard
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Expert Buyer — Spec Showdown',
    description: 'Car enthusiast who knows specs better than most salespeople. Tests ability to add value beyond spec sheets.',
    total_steps: 3,
    difficulty: 'hard',
    taxonomy_domains: ['product_knowledge'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}, a car enthusiast who reads every review and forum post. Say: "I already know the {vehicle} has 301 horsepower and an 8-speed transmission. I have read every Car and Driver review. Tell me something I cannot find on the internet — what do your actual customers say about it after 6 months?" Challenge them to go beyond specs.',
        persona: { mood: 'testing', situation: 'knows more than average salesperson' },
      },
      {
        step: 2,
        branches: {
          unimpressed: {
            prompt: 'You are {customer_name}. The salesperson just repeated spec sheet info. Say: "You just told me things I already told you I know. What I want is your personal experience. Have you driven it? What did customers complain about? I respect honesty more than a sales pitch." Be direct but not mean.',
            persona: { mood: 'unimpressed', situation: 'wants authenticity not specs' },
          },
          default: {
            prompt: 'You are {customer_name}. Good insights. Say: "Now that is what I wanted to hear. Let me ask you this — the {competitor_vehicle} has a better JD Power reliability score. But reliability scores do not tell the whole story. What is your service department seeing?" Push on real-world reliability.',
            persona: { mood: 'engaged', situation: 'reliability deep dive' },
          },
        },
        branch_rules: {
          unimpressed: 'product_knowledge < 3.5',
        },
      },
      {
        step: 3,
        base_prompt: 'You are {customer_name}. Decision time. Say: "Here is where I am. The {vehicle} checks most boxes. But I am also looking at a CPO {competitor_vehicle} that is two years old with 20k miles for $8,000 less. Make the case for buying new versus certified pre-owned." This is the hardest question — new vs CPO value proposition.',
        persona: { mood: 'analytical', situation: 'new vs CPO decision' },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CLOSING TECHNIQUE — Easy
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Warm Close — Ready Buyer',
    description: 'Customer who likes the car and is ready to buy but needs a confident close. Tests basic closing skills.',
    total_steps: 3,
    difficulty: 'easy',
    taxonomy_domains: ['closing_technique'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}. You test drove the {vehicle} and loved it. Say: "Wow, that drove really well. The seats are comfortable and I love the technology. This is definitely on my short list." You are enthusiastic but have not committed. Give buying signals.',
        persona: { mood: 'enthusiastic', situation: 'post test drive, giving buying signals' },
      },
      {
        step: 2,
        branches: {
          cooling_off: {
            prompt: 'You are {customer_name}. The salesperson did not try to close. You are losing momentum. Say: "Well, I have a few other cars to look at this weekend. Maybe I will come back next week." You are drifting away because nobody asked for the sale.',
            persona: { mood: 'cooling off', situation: 'about to leave without buying' },
          },
          default: {
            prompt: 'You are {customer_name}. Say: "I am really leaning toward this one. My only question is whether I should get the mid trim or the top trim. The top trim has the sunroof and premium audio but it is $3,000 more. What do you think?" You want guidance.',
            persona: { mood: 'leaning yes', situation: 'trim decision' },
          },
        },
        branch_rules: {
          cooling_off: 'close_attempt < 2.0',
        },
      },
      {
        step: 3,
        base_prompt: 'You are {customer_name}. Say: "OK, I think I am ready. What are the next steps? And is there anything special going on this month that I should know about?" You are ready to buy — just need the salesperson to guide you through it.',
        persona: { mood: 'ready', situation: 'asking for next steps' },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CLOSING TECHNIQUE — Medium
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Spouse Approval Close',
    description: 'Customer needs spouse buy-in. Tests ability to build value for the absent decision-maker and create urgency.',
    total_steps: 3,
    difficulty: 'medium',
    taxonomy_domains: ['closing_technique'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}. You love the {vehicle} but say: "I really like it but I need to talk to my wife first. She has not seen it yet and we make these decisions together." Be genuine — this is not an excuse, you really do need spouse approval.',
        persona: { mood: 'genuine', situation: 'needs spouse approval' },
      },
      {
        step: 2,
        branches: {
          stalling: {
            prompt: 'You are {customer_name}. You came back without your spouse. Say: "She is busy with the kids today so I came alone. She said she trusts my judgment but I do not want to make a mistake. What if she does not like the color?" You are overthinking it.',
            persona: { mood: 'anxious', situation: 'overthinking without spouse present' },
          },
          default: {
            prompt: 'You are {customer_name}. You brought your spouse. She says: "It is nice but I am worried about the monthly payment. We have the kids college fund to think about." She is the practical one. Your job as the salesperson is to address her concerns while keeping you excited.',
            persona: { mood: 'mixed', situation: 'spouse present with budget concerns' },
          },
        },
        branch_rules: {
          stalling: 'close_attempt < 2.5',
        },
      },
      {
        step: 3,
        branches: {
          needs_push: {
            prompt: 'You are {customer_name}. Say: "We both like it. I just need to know — if we walk out today and come back next week, will this exact deal still be available? Because I do not want to feel pressured." You need reassurance, not pressure.',
            persona: { mood: 'cautious', situation: 'fear of pressure tactics' },
          },
          default: {
            prompt: 'You are {customer_name}. Say: "My wife is on board. She liked the safety ratings. We are ready to talk numbers. What does the out-the-door price look like?" You are both ready. Close it.',
            persona: { mood: 'decided', situation: 'both spouses aligned, ready for numbers' },
          },
        },
        branch_rules: {
          needs_push: 'close_attempt < 3.0',
        },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CLOSING TECHNIQUE — Hard
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'The Ghost — Re-engage and Close',
    description: 'Customer who went silent after test drive. Tests follow-up, re-engagement, and soft close techniques.',
    total_steps: 3,
    difficulty: 'hard',
    taxonomy_domains: ['closing_technique'],
    vehicle_required: true,
    step_prompts: [
      {
        step: 1,
        base_prompt: 'You are {customer_name}. You test drove a {vehicle} last week but never came back or responded to the follow-up call. The salesperson is reaching out again. You answer but are evasive: "Oh yeah, I have been busy. I have not really thought about it much. What is up?" You are not hostile but not engaged either.',
        persona: { mood: 'disengaged', situation: 'ghosted after test drive' },
      },
      {
        step: 2,
        branches: {
          still_cold: {
            prompt: 'You are {customer_name}. The follow-up did not re-engage you. Say: "Yeah, I am just not sure it is the right time. Maybe in a few months." You are using timing as an excuse because the salesperson did not give you a reason to act now.',
            persona: { mood: 'noncommittal', situation: 'using timing excuse' },
          },
          default: {
            prompt: 'You are {customer_name}. The salesperson got your attention. Say: "Actually, funny you called. My check engine light came on in my current car yesterday. So maybe the timing is better than I thought. But I was also looking at the {competitor_vehicle}. Why should I come back to you?" You are open but need a reason.',
            persona: { mood: 'interested', situation: 'current car problems, shopping around' },
          },
        },
        branch_rules: {
          still_cold: 'close_attempt < 2.0',
        },
      },
      {
        step: 3,
        branches: {
          last_chance: {
            prompt: 'You are {customer_name}. Say: "Honestly, the {competitor_vehicle} dealer is closer to my house and they already sent me a quote. Unless you can give me a reason to drive all the way out there, I will probably just go with them." This is the last chance. It is about convenience and effort, not price.',
            persona: { mood: 'practical', situation: 'competitor has convenience advantage' },
          },
          default: {
            prompt: 'You are {customer_name}. Say: "Alright, you have got my attention. I can come in Saturday morning. But I am not spending all day at a dealership. If we can get the whole thing done in two hours including paperwork, I am in." You will buy but have conditions.',
            persona: { mood: 'conditional yes', situation: 'will buy with time commitment' },
          },
        },
        branch_rules: {
          last_chance: 'close_attempt < 2.5',
        },
      },
    ],
  },
];

async function seed() {
  console.log(`Seeding ${templates.length} chain templates...`);

  // Check for existing templates
  const { count } = await supabase
    .from('chain_templates')
    .select('id', { count: 'exact', head: true });

  if (count && count > 0) {
    console.log(`Found ${count} existing templates. Skipping seed (idempotent).`);
    console.log('To re-seed, DELETE FROM chain_templates first.');
    return;
  }

  const { data, error } = await supabase
    .from('chain_templates')
    .insert(templates)
    .select('id, name, difficulty');

  if (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }

  console.log(`Seeded ${data.length} templates:`);
  for (const t of data) {
    console.log(`  ${t.difficulty.padEnd(6)} | ${t.name}`);
  }
}

seed().catch(console.error);
