/**
 * Shared gold-set for the grading + follow-up eval harnesses.
 *
 * 9 real, active scenario_bank scenarios (3 per weight class) with a hand-authored
 * STRONG answer (paraphrases the elite_dialogue) and WEAK answer (exhibits the
 * fail_signals) for each. Strong answers must grade materially higher than weak
 * ones; this is the regression signal that catches prompt/model calibration drift.
 *
 * Keep this in sync with prod when scenarios change materially:
 *   npx tsx scripts/export-scenario-bank.ts   (regenerates the full bank CSV)
 */

export type Mode = 'roleplay' | 'quiz' | 'objection';
export type WeightClass = 'fact_heavy' | 'hybrid' | 'rapport_heavy';

export interface GoldCase {
  scenarioId: string;
  mode: Mode;
  weightClass: WeightClass;
  domain: string;
  /** customer_line — the opening scenario / customer message */
  scenario: string;
  techniqueTag: string;
  eliteDialogue: string;
  failSignals: string;
  /** A strong rep answer (correct, on-technique, good tone) */
  strongAnswer: string;
  /** A weak rep answer (exhibits the fail_signals) */
  weakAnswer: string;
}

export const GOLD_SET: GoldCase[] = [
  // ── fact_heavy (product knowledge quizzes) ─────────────────────────────────
  {
    scenarioId: '056',
    mode: 'quiz',
    weightClass: 'fact_heavy',
    domain: 'product_knowledge',
    scenario: "What's the actual difference between AWD and 4WD? My customer asked and I froze.",
    techniqueTag: 'AWD vs 4WD KNOWLEDGE',
    eliteDialogue:
      "AWD is always on -- it automatically sends power where it's needed. Best for rain, snow, everyday driving. 4WD is selectable -- the driver engages it for off-road, heavy towing, rough terrain, using a transfer case. Simple way to say it: AWD does the thinking for you, 4WD lets you take control. Match it to how they drive.",
    failSignals: 'uses the terms interchangeably | can\'t explain when one is better | says "they\'re basically the same thing"',
    strongAnswer:
      "AWD is always on and moves power automatically -- great for rain, snow, daily driving, no button needed. 4WD is selectable through a transfer case for off-road and heavy towing. Tell them: AWD thinks for you, 4WD lets you take control. Then match it to how they actually drive.",
    weakAnswer:
      "They're basically the same thing honestly -- both send power to all four wheels so the customer will be fine either way. I'd just tell them not to worry about it.",
  },
  {
    scenarioId: '057',
    mode: 'quiz',
    weightClass: 'fact_heavy',
    domain: 'product_knowledge',
    scenario: "A customer asks: 'What makes your SUV safer than the competition?' Name three specific features.",
    techniqueTag: 'THREE SPECIFIC DIFFERENTIATORS',
    eliteDialogue:
      "Three specifics that differentiate: forward collision using radar AND camera fusion (some rivals are camera-only), side curtain airbags that extend to the third row, and an ultra-high-strength steel cage at the A and B pillars. Know your brand's three strongest differentiators cold.",
    failSignals: 'says "it has lots of airbags" | can\'t name specific technologies | names features every competitor also has',
    strongAnswer:
      "Three specifics: forward collision that fuses radar and camera, not camera-only like some competitors; side curtain airbags that reach the third row; and an ultra-high-strength steel cage at the A and B pillars. Those are real differentiators, not just 'it's safe.'",
    weakAnswer:
      "It's just really safe -- it's got tons of airbags and great crash ratings. Honestly all the SUVs in this class are safe so I'd just reassure them it's a safe pick.",
  },
  {
    scenarioId: '059',
    mode: 'quiz',
    weightClass: 'fact_heavy',
    domain: 'product_knowledge',
    scenario: "A customer says their current car gets 35 MPG. How do you position a vehicle that only gets 28?",
    techniqueTag: 'ACKNOWLEDGE then TOTAL-COST',
    eliteDialogue:
      "Don't argue the MPG. Acknowledge it: 'You're right, it's about 7 less. At 15,000 miles a year that's roughly $30-$40 more a month in gas -- but this has lower insurance, stronger resale, and the safety features that protect your family. That $30 buys a lot.' Shift MPG to total cost of ownership.",
    failSignals: 'argues that 28 is "still good" | can\'t do the cost-per-month math | ignores the MPG concern entirely',
    strongAnswer:
      "You're right, that's about 7 MPG less. At 15k miles a year it's only around $30-$40 more a month in gas -- and this one has lower insurance, stronger resale, and better safety. So we're really trading $30 a month for a lot more value. Fair way to look at it?",
    weakAnswer:
      "28 is still really good gas mileage though, I wouldn't worry about it. Most cars this size are around there so 35 isn't that realistic anyway.",
  },

  // ── hybrid (price / value objections) ──────────────────────────────────────
  {
    scenarioId: '001',
    mode: 'objection',
    weightClass: 'hybrid',
    domain: 'objection_handling',
    scenario: 'I saw the same car advertised online for way less. Why is your price so much higher?',
    techniqueTag: 'AGREE then REFRAME',
    eliteDialogue:
      "Good -- I'm glad you found that. Pull it up right now, let's look together. And I'll promise you: if they're genuinely beating us on the same car in the same condition, I'll tell you to buy it there. But nine times out of ten, line by line, their price is missing something ours isn't. Let's find out.",
    failSignals: 'immediately matches price | says "where did you see that" defensively | drops price without building value',
    strongAnswer:
      "Good, I'm glad you're doing the homework -- pull it up and let's compare side by side. If it's truly the same car, same condition, and they beat us, I'll tell you to buy it there. Usually when we go line by line their number is missing something ours includes. Let's find out which.",
    weakAnswer:
      "Where'd you even see that? Okay, you know what, just tell me their price and I'll match it. I don't want to lose the deal over a few hundred bucks.",
  },
  {
    scenarioId: '002',
    mode: 'objection',
    weightClass: 'hybrid',
    domain: 'objection_handling',
    scenario: "Look, I know what invoice is. I've done my research. I'm not paying a dollar over that.",
    techniqueTag: 'RESPECT then EDUCATE',
    eliteDialogue:
      "I respect the homework -- most people don't dig that deep. But here's what nobody tells you: a dealer selling at invoice cut a corner somewhere -- reconditioning, the inspection, or they make it back on your financing. Invoice isn't the finish line, it's a trap. Let me show you what your money actually buys at our number.",
    failSignals: 'argues about invoice accuracy | caves to invoice pricing | gets defensive about profit margin',
    strongAnswer:
      "I respect that you dug into invoice -- most people don't. Here's the thing though: a store selling at invoice usually made it back somewhere, whether that's reconditioning, a rushed inspection, or the financing on the back end. Let me show you what our number actually includes so you can compare apples to apples.",
    weakAnswer:
      "Invoice pricing isn't even accurate, those numbers online are wrong. But fine, if that's what it takes I can probably do invoice, let me just go ask my manager.",
  },
  {
    scenarioId: '003',
    mode: 'objection',
    weightClass: 'hybrid',
    domain: 'objection_handling',
    scenario: "We like the car, but it's just out of our budget. Can you knock off another $3,000?",
    techniqueTag: 'ISOLATE then REFRAME',
    eliteDialogue:
      "I hear you and I want to make this work. Quick question: when you say $3,000, do you mean the total price or the monthly payment? Those are two different problems and I might be able to solve one right now. Which one keeps you up at night?",
    failSignals: 'immediately discounts $3K | says "let me talk to my manager" without qualifying | switches to cheaper car',
    strongAnswer:
      "I want to make this work with you. When you say $3,000, are we talking total price or the monthly payment? Those are two very different problems and I may be able to solve one of them right now. Which one is the real sticking point for you?",
    weakAnswer:
      "Let me go talk to my manager and see if I can get you $3,000 off. If not I can probably show you something cheaper on the lot instead.",
  },

  // ── rapport_heavy (spouse / relationship / trust) ──────────────────────────
  {
    scenarioId: '017',
    mode: 'objection',
    weightClass: 'rapport_heavy',
    domain: 'closing_technique',
    scenario: "I love it, but my wife needs to see it first. She'll kill me if I buy without her.",
    techniqueTag: 'VALIDATE then STRUCTURE',
    eliteDialogue:
      "I respect that -- big decisions should be made together. Before you left, did you two talk about what the deal needed to look like? If you know her numbers, let's lock those in now so you bring home a done deal, not a fresh start. Or want to FaceTime her right now and get her in on it?",
    failSignals: 'says "bring her in whenever" | doesn\'t attempt to structure the deal | ignores the spouse entirely',
    strongAnswer:
      "Totally respect that -- this should be a joint decision. Did you two talk about what the deal needed to look like before you came in? If you know the numbers she'd be good with, let's lock them in so you're bringing home a finished deal. Or we could FaceTime her right now so she's part of it.",
    weakAnswer:
      "No problem at all, just bring her in whenever you two have time and we'll go from there. Take your time, no rush.",
  },
  {
    scenarioId: '018',
    mode: 'objection',
    weightClass: 'rapport_heavy',
    domain: 'closing_technique',
    scenario: "My husband handles the finances. I can't commit to anything without talking to him tonight.",
    techniqueTag: 'EMPOWER then BRIDGE',
    eliteDialogue:
      "I get it -- you should be on the same page. But you're the one who found it, drove it, and loved it. Let's lock the numbers exactly where you're comfortable so tonight you show him a finished deal, not ask permission to start shopping. If he's got questions, here's my direct number -- he can call me tonight. Fair?",
    failSignals: 'defers completely | says "have him come in" without structuring | talks past her to the "real decision maker"',
    strongAnswer:
      "That makes sense, you should decide together. But you're the one who found it and loved it -- let's set the numbers exactly where you're comfortable so tonight you're showing him a done deal instead of starting over. Here's my direct cell if he has any questions when you talk. Sound fair?",
    weakAnswer:
      "Okay, well since he handles the money, maybe just have him come in with you next time so I can go over everything with him directly.",
  },
  {
    scenarioId: '054',
    mode: 'roleplay',
    weightClass: 'rapport_heavy',
    domain: 'closing_technique',
    scenario: "I like the car but I'm not sure about your dealership. What happens if I have problems after the sale?",
    techniqueTag: 'SELL THE RELATIONSHIP',
    eliteDialogue:
      "That's the right question. After you drive off, here's my personal cell -- any problem, any question, you call me first. Our service department has loaner cars, and I'll walk you through the warranty process myself. Let me introduce you to our service manager right now so you know exactly who's taking care of you.",
    failSignals: 'says "we have great service" generically | can\'t describe the post-sale process | no personal connection offered',
    strongAnswer:
      "Right question to ask. Here's my personal cell -- after the sale, any issue, you call me first. Our service team does loaner cars and I'll personally walk you through the warranty process. Come with me, let me introduce you to our service manager right now so you know who's got your back.",
    weakAnswer:
      "Oh don't worry, we have really great service here, everybody says so. If anything comes up just give the dealership a call and someone will help you out.",
  },
];
