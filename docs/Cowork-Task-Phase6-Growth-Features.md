# Cowork Task: Phase 6 — Growth Features

## Objective

Four engagement features that make the product feel alive. These create competitive differentiation no other platform offers and make reps say "this thing knows me."

## Context

- All prior phases complete: auth, engine, dashboard, training intelligence, Coach Mode, morning meeting script, billing
- These features build ON TOP of working infrastructure — don't refactor, extend
- All features are feature-flagged (default OFF). Enable per dealership individually.
- Subscription gating from Phase 5 applies to all Phase 6 features
- SMS message cap: 3 per employee per 24 hours. Phase 6 features CONSUME cap messages, not add to them.
- GSM-7 encoding only. No emoji in any SMS.
- Build plan spec: `DealershipIQ-Strategic-Build-Order-v5.md` Phase 6
- Architecture spec: `DealershipIQ-Architecture-Reference` §Feature B, C, E, H

## Critical Cross-Feature Rules (Read Before Building Any Feature)

### Training Cron Content Priority (Definitive Order)

When the daily training-trigger cron selects content for an employee, evaluate in this order. First match wins:

```
1. Manager Quick-Create scenario (unexpired, not yet pushed)     — Feature C
2. Active peer challenge scenario (status = 'active')            — Feature H
3. Active scenario chain (next step due today)                   — Feature B
4. Daily challenge (if daily_challenge_enabled for this day)     — Feature E
5. Adaptive-weighted standalone scenario                         — Feature A (Phase 4)
```

Manager override beats everything. Active peer challenge beats everything except manager override (it was already initiated, both parties are waiting). Chain continuation beats daily challenge (don't break a multi-day arc for a one-off). Daily challenge beats adaptive weighting.

**This list must be implemented as a single function** in the training-trigger cron, not scattered across feature modules. Each feature's module provides a `check` function; the cron calls them in order.

### Message Cap Enforcement

3 outbound system messages per employee per 24 hours. All Phase 6 features consume from this cap. A challenge day (daily or peer) IS the training day — not in addition to it.

**Check remaining cap BEFORE initiating any feature interaction.** If cap is reached, queue for tomorrow or block the interaction with a clear response.

### Feature Interaction Matrix

| If BOTH enabled... | What happens? |
|---------------------|--------------|
| Daily Challenge + Scenario Chain | Challenge days pause the chain. Chain resumes on the next non-challenge day. Challenge takes priority to maintain team-wide competitive energy. |
| Peer Challenge + Scenario Chain | Peer challenge pauses the chain for that day for BOTH participants. |
| Peer Challenge + Daily Challenge | Peer challenge blocked on daily challenge days. "Today is a team challenge day. Try peer challenge tomorrow." |
| Manager Quick-Create + anything | Manager scenario overrides everything. It's a one-time push, not recurring. |

## Build Order

| Step | Feature | Why This Order |
|------|---------|---------------|
| 6A | Manager Quick-Create (C) | Simplest. SMS keyword + AI. Uses existing push training. |
| 6B | Daily Challenge (E) | Medium. Two cron touchpoints. Introduces shared-scenario pattern. |
| 6C | Progressive Scenario Chains (B) | Most complex. New state management, branching, multi-day narrative. |
| 6D | Peer Challenge (H) | Builds on shared-scenario grading from 6B. Adds async matching. |

---

## 6A — Manager Quick-Create via SMS (Feature C)

### What It Does

Manager texts a scenario idea. AI generates a full training scenario with grading rubric. Pushes to team immediately or at next training window.

### Keyword Detection

Messages from `role IN ('owner', 'manager')` that start with `TRAIN:` (case-insensitive, with colon).

**Routing:**
1. Look up inbound phone in `dealership_memberships`
2. Manager + `TRAIN:` prefix → manager-create handler
3. Manager without prefix → normal training flow (managers train too)
4. Non-manager + `TRAIN:` → "Only managers can create training scenarios."

**Check `manager_quick_create_enabled` flag before processing.**

### NOW Keyword State Management

After generating a scenario, the system tells the manager "Reply NOW to send immediately." The webhook needs to know the manager's next message might be "NOW."

**State tracking:** When the system creates a manager scenario and sends the "Reply NOW" confirmation, set a field on the `manager_scenarios` row:

```sql
awaiting_now_confirmation BOOLEAN DEFAULT false,
now_confirmation_expires_at TIMESTAMPTZ  -- 30 min from creation
```

**When the next message arrives from this manager:**
1. Check: does this manager have a `manager_scenarios` row where `awaiting_now_confirmation = true` AND `now_confirmation_expires_at > now()`?
2. If yes AND message body is exactly "NOW" (case-insensitive, trimmed): push scenario immediately, set `awaiting_now_confirmation = false`, set `pushed_at = now()`
3. If yes AND message is NOT "NOW": clear the flag (`awaiting_now_confirmation = false`), route message to normal training flow. Scenario stays queued for next training window.
4. If no pending confirmation: route normally

**This prevents "NOW" from being misinterpreted.** Only triggers when there's a pending scenario awaiting confirmation AND the message is exactly "NOW."

### Flow

```
Manager texts: "TRAIN: New hire can't handle 'I need to think about it' objection"

1. Webhook: manager role + TRAIN: prefix → manager-create handler
2. Strip "TRAIN:", pass remaining text to GPT-4o
3. AI generates: scenario text, persona, taxonomy domain, difficulty, grading rubric (Structured Output)
4. Store in manager_scenarios table (source = 'manager_sms', awaiting_now_confirmation = true)
5. Reply to manager:
   "Got it. Created 'think about it' objection scenario.
    Sending to your team at next training window.
    Reply NOW to send immediately."
6. Manager replies NOW within 30 min → push via existing push training flow
7. Manager doesn't reply NOW → cron picks it up at next training window
```

### AI Prompt

```
You are a training content specialist for automotive dealership salespeople.

A sales manager described a situation they want their team to practice:
"{manager_input}"

Generate a training scenario as JSON:
{
  "scenario_text": "Customer-facing text, under 300 chars, conversational",
  "customer_persona": "brief description",
  "taxonomy_domain": "objection_handling|product_knowledge|closing_technique|competitive_positioning|financing",
  "difficulty": "easy|medium|hard",
  "grading_rubric": {
    "product_accuracy": "what to look for",
    "tone_rapport": "what to look for",
    "concern_addressed": "what to look for",
    "close_attempt": "what to look for",
    "urgency_creation": "what to look for or null if not relevant",
    "competitive_positioning": "what to look for or null if not relevant"
  }
}

Rules:
- Scenario must feel like a real customer interaction
- Rubric reflects what the manager described
- If manager mentions a specific vehicle, use provided vehicle data
- If description is vague, make reasonable assumptions about the customer situation
```

### Migration

```sql
CREATE TABLE manager_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  created_by UUID NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manager_sms'
    CHECK (source IN ('manager_sms', 'manager_web', 'imported')),
  manager_input_text TEXT NOT NULL,        -- Original text from manager
  scenario_text TEXT NOT NULL,             -- AI-generated scenario
  customer_persona TEXT,
  taxonomy_domain TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  grading_rubric JSONB NOT NULL,
  vehicle_context JSONB,
  awaiting_now_confirmation BOOLEAN DEFAULT false,
  now_confirmation_expires_at TIMESTAMPTZ,
  push_immediately BOOLEAN DEFAULT false,
  pushed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                  -- Optional: manager can set for promos
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_scenarios_dealership
  ON manager_scenarios(dealership_id, created_at DESC);
CREATE INDEX idx_manager_scenarios_pending
  ON manager_scenarios(created_by, awaiting_now_confirmation)
  WHERE awaiting_now_confirmation = true;
```

### SMS Budget

- Manager's TRAIN: message + system reply → 0 against employee cap
- Scenario push to reps → counts as 1 of 3 daily messages per employee
- If employee already at cap, scenario queues for tomorrow

---

## 6B — Daily Challenge + Leaderboard Push (Feature E)

### What It Does

Morning text to all reps: yesterday's top 3 + today's shared challenge scenario. Same scenario for everyone. End-of-day grading ranks all responses.

### How It Replaces Regular Training

**On challenge days, the challenge IS the training.** The rep receives the challenge scenario instead of their adaptive-weighted scenario. Their response is graded normally through the existing conversation_session flow. The challenge just changes WHAT they're asked, not HOW it's processed.

**Message flow on a challenge day:**
1. Morning: challenge scenario + yesterday's results (message 1 of 3)
2. Rep responds → graded normally → feedback sent (message 2 of 3)
3. End-of-day: results announcement (message 3 of 3)

### Coordination with Morning Meeting Script

**The daily challenge topic MUST match the morning meeting script's coaching focus.** When `daily_challenge_enabled` is true:

1. Morning meeting script cron (7am local) generates the script AND selects today's challenge topic (using the team's weakest adaptive weighting domain, same as the coaching focus)
2. The challenge scenario is generated from this same topic and stored in `daily_challenges`
3. The morning meeting script's "COACHING FOCUS" section references the challenge: "Today's team challenge is about closing technique. Ask Sarah to demo her approach."
4. Training cron (9am local) sends the pre-generated challenge scenario to all reps

**When `daily_challenge_enabled` is false:** Morning meeting script still has a coaching focus (suggestion only, as built in Phase 4.5B). No automated challenge scenario sent.

### Challenge Frequency

Not every day needs to be a challenge day. Configurable via feature flag config JSONB:

```sql
INSERT INTO feature_flags VALUES ('{dealership_id}', 'daily_challenge_enabled', false,
  '{"frequency": "mwf"}');
-- Options: "daily" (every work day), "mwf" (Mon/Wed/Fri), "tue_thu" (Tue/Thu)
```

Non-challenge days: reps get normal adaptive-weighted training (or chain steps if chains are active).

### Migration

```sql
CREATE TABLE daily_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  challenge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scenario_text TEXT NOT NULL,
  grading_rubric JSONB NOT NULL,
  taxonomy_domain TEXT NOT NULL,
  persona_mood TEXT,
  vehicle_context JSONB,
  results JSONB,                    -- Populated EOD: [{user_id, first_name, score, rank}]
  winner_user_id UUID REFERENCES users(id),
  participation_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'grading', 'completed', 'no_responses')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealership_id, challenge_date)
);

CREATE INDEX idx_daily_challenges_dealership_date
  ON daily_challenges(dealership_id, challenge_date DESC);

-- Link sessions to challenges
ALTER TABLE conversation_sessions ADD COLUMN challenge_id UUID REFERENCES daily_challenges(id);
```

### Morning Flow (Inside Training-Trigger Cron)

For each dealership where `daily_challenge_enabled` is true AND today matches the frequency config:

1. Load today's `daily_challenges` row (pre-created by morning meeting script cron at 7am)
2. If not found (morning script cron failed or hasn't run): generate challenge now as fallback
3. For each active employee (not off, not at cap, subscription active):
   - Build morning SMS combining yesterday's results + today's scenario:
     ```
     Yesterday's best: {name} ({score}%).
     Top 3: {n1}, {n2}, {n3}.
     TODAY: {scenario_text} Best response by 5pm.
     ```
   - Create conversation_session linked to this challenge_id
   - Send SMS (message 1 of 3)

**Grading:** Happens immediately when rep responds, via normal training flow. The `challenge_id` on the session links it back for end-of-day ranking.

### End-of-Day Results Cron

New cron: `POST /api/cron/challenge-results`
Schedule: `0 * * * *` (hourly), fires where `local_hour = 17`

```
For each dealership with an active daily_challenge today:
  1. Query all completed conversation_sessions with this challenge_id
  2. Calculate average score per rep across grading dimensions
  3. Rank by score. Tiebreaker: earliest response time.
  4. Update daily_challenges: results JSONB, winner_user_id, participation_count, status = 'completed'
  5. SMS to all participants:
     "Challenge results: 1. {name} ({score}%) 2. {name} ({score}%) 3. {name} ({score}%).
      {winner} takes it today."
     (message 3 of 3)
  6. If zero responses: status = 'no_responses', no SMS sent
  7. If 1-2 participants: still rank and announce
```

**Cron budget: 1 new slot.** Total: 7 of 40.

---

## 6C — Progressive Scenario Chains (Feature B)

### What It Does

3-day storylines across training sessions. Day 1 introduces a customer. Day 2 continues based on how the rep handled Day 1. Day 3 escalates. Each day's grading informs the next.

### Why This Is Hard

Chains maintain narrative state across multiple calendar days over stateless SMS. On each inbound webhook, the system must reconstruct full narrative context from the database, apply branching logic based on prior grading, generate contextually appropriate scenarios, and handle schedule interruptions without breaking the story.

### Migration

```sql
CREATE TABLE chain_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  total_steps INTEGER NOT NULL DEFAULT 3,
  step_prompts JSONB NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  taxonomy_domains TEXT[] NOT NULL,
  vehicle_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenario_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  user_id UUID NOT NULL REFERENCES users(id),
  chain_template_id UUID NOT NULL REFERENCES chain_templates(id),
  current_step INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 3,
  chain_context JSONB NOT NULL DEFAULT '{}',
  step_results JSONB[] NOT NULL DEFAULT ARRAY[]::jsonb[],
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'expired')),
  work_days_without_response INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_step_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_chains_user_active
  ON scenario_chains(user_id, status) WHERE status = 'active';
CREATE INDEX idx_scenario_chains_dealership
  ON scenario_chains(dealership_id, created_at DESC);

ALTER TABLE conversation_sessions ADD COLUMN scenario_chain_id UUID REFERENCES scenario_chains(id);
ALTER TABLE conversation_sessions ADD COLUMN chain_step INTEGER;
```

**chain_context structure:**
```typescript
{
  customer_name: string;            // "Mrs. Johnson"
  vehicle: string;                  // "2025 CR-V Sport Touring"
  competitor_vehicle: string | null; // "2025 RAV4 XLE"
  stated_objections: string[];      // ["worried about monthly payment"]
  prior_responses_summary: string;  // "Day 1: Rep focused on features but didn't ask for the sale..."
  emotional_state: string;          // "interested but cautious"
  branch_taken: string | null;      // "low_close" — which branch was selected for current step
}
```

**step_prompts structure (on chain_templates):**
```typescript
[
  {
    step: 1,
    base_prompt: "Customer walks in interested in the {vehicle}...",
    persona: { mood: "friendly", situation: "first visit" }
    // No branches on step 1 — everyone gets the same start
  },
  {
    step: 2,
    branches: {
      low_close: {
        prompt: "Customer returns with spouse, worried about payment...",
        persona: { mood: "hesitant", situation: "spouse pressure" }
      },
      low_product: {
        prompt: "Customer returns asking specific questions about {vehicle} vs {competitor}...",
        persona: { mood: "analytical", situation: "comparison shopping" }
      },
      default: {
        prompt: "Customer returns ready to talk numbers. Budget: $400/month...",
        persona: { mood: "engaged", situation: "ready to negotiate" }
      }
    },
    branch_rules: {
      low_close: "close_attempt < 2.5",
      low_product: "product_accuracy < 2.5"
    }
  },
  {
    step: 3,
    branches: {
      // Similar structure, escalated difficulty
    },
    branch_rules: { ... }
  }
]
```

### Chain Lifecycle

**Starting a chain:**
- Daily cron checks: does this employee have an active chain? (content priority #3)
- If no active chain AND `scenario_chains_enabled`:
  - Select template based on: employee's adaptive weighting weakest domains + tenure-appropriate difficulty
  - Create `scenario_chains` row with initial `chain_context` (populated with customer name, vehicle from vehicle data, etc.)
  - Generate Day 1 scenario from template step 1 + context
  - Send as today's training

**Continuing a chain (Day 2, Day 3):**
- Cron detects active chain for this employee
- Load chain from database (full state reconstruction)
- Load Day N-1 grading results from `step_results` array
- Execute branching: evaluate `branch_rules` against prior step scores
- Generate Day N scenario: inject `chain_context` + `step_results` + selected branch template → GPT-4o
- Update `chain_context` with narrative continuity (summarize Day N-1 exchange)
- Increment `current_step`, update `last_step_at`
- Send as today's training

**Completing a chain:**
- After Day 3 (or `total_steps`) grading completes:
- Update status = 'completed'
- Send summary SMS:
  ```
  {customer_name}'s story is complete. Your scores:
  Day 1: {score}% Day 2: {score}% Day 3: {score}%.
  {improvement_note}
  ```
- Update adaptive weighting priority vectors with 3-day aggregate scores
- Next training day: fresh standalone scenario or new chain

### Branching Algorithm

**Deterministic rule evaluation. NOT LLM-driven.** The LLM generates scenario text; the branch selection is a simple comparison.

```typescript
function selectBranch(
  stepConfig: StepConfig,
  previousResults: StepResult
): BranchTemplate {
  if (!stepConfig.branches) return stepConfig; // Step 1, no branches

  for (const [branchName, ruleString] of Object.entries(stepConfig.branch_rules)) {
    // Rule format: "dimension_name < threshold"
    const match = ruleString.match(/^(\w+)\s*(<|>|<=|>=)\s*([\d.]+)$/);
    if (!match) continue;

    const [, dimension, operator, thresholdStr] = match;
    const score = previousResults.scores[dimension];
    const threshold = parseFloat(thresholdStr);

    if (score == null) continue; // Missing dimension, skip this rule

    const triggered =
      operator === '<' ? score < threshold :
      operator === '>' ? score > threshold :
      operator === '<=' ? score <= threshold :
      operator === '>=' ? score >= threshold : false;

    if (triggered) return stepConfig.branches[branchName];
  }

  return stepConfig.branches['default'];
}
```

### Schedule + Expiry Interaction

- **Off day:** Chain pauses. The step doesn't advance but the chain doesn't expire either. Work-day counting resumes when the rep returns.
- **Missed step on a work day (no response):** Increment `work_days_without_response`. The chain tries again the next work day (same step, not advanced).
- **Expiry:** If `work_days_without_response >= 3`: set status = 'expired'. Rep gets fresh standalone training next day. No penalty, no negative message — chains are engagement hooks, not obligations.
- **Challenge day (daily or peer) during active chain:** Chain pauses for that day. Resumes next non-challenge day. `work_days_without_response` is NOT incremented on challenge days (the rep WAS active, just on something else).

### Chain Template Seeding

Create 5-8 templates covering the core taxonomy domains. Use the same approach as competitive_sets: **LLM generates drafts, Ken reviews/edits.**

Create script: `scripts/generate-chain-templates.ts`

**For each taxonomy domain, generate one template:**
1. `objection_handling` — "The Think-About-It Customer" (price/timing objection arc)
2. `closing_technique` — "The Almost-Ready Buyer" (builds to negotiation)
3. `product_knowledge` — "The Research-Heavy Customer" (competitive comparison arc)
4. `competitive_positioning` — "The Cross-Shopping Customer" (competitor dealership threat)
5. `financing` — "The Credit-Worried Family" (payment/credit fear arc)

**Plus 2-3 advanced combos:**
6. `objection_handling + closing` — "The Returning Customer with Spouse" (multi-day multi-objection)
7. `product_knowledge + competitive` — "The EV-Curious Customer" (technology confusion arc)

Each template follows the structure in the step_prompts spec above. LLM generates the prompt text and branch rules. Ken reviews before they go into production (same `generated_by` / `reviewed_at` pattern as competitive_sets).

### Feature Flag

```sql
INSERT INTO feature_flags VALUES ('{dealership_id}', 'scenario_chains_enabled', false, NULL);
```

---

## 6D — Peer Challenge Mode (Feature H)

### What It Does

Rep texts CHALLENGE [name]. Both get the same scenario. AI grades both independently. Results texted to both.

### Keyword Detection

Detect messages starting with `CHALLENGE ` (case-insensitive, space after word).

**Disambiguation from training responses:** A rep mid-roleplay might write "Challenge the customer to reconsider..." which starts with "challenge." Rule: CHALLENGE keyword only triggers if the message is under 40 characters AND starts with "CHALLENGE " (with a space). Longer messages route to training.

```
CHALLENGE Mike          → keyword (17 chars, starts with "CHALLENGE ")
CHALLENGE mike s        → keyword
Challenge the customer  → training response (routes normally)
```

**Check `peer_challenge_enabled` flag and subscription status before processing.**

### Scenario Selection

**Use the challenger's weakest adaptive weighting domain** to select the scenario topic. This makes challenges feel relevant to the person who initiated. The challenged rep may have a different weakness — that's fine. The shared scenario tests both of them on the same material, which is the competitive element.

If the challenger has no priority vector data yet, select a random domain.

Generate the scenario using the same prompt pipeline as regular training (persona mood if enabled, vehicle data if enabled), but store it on the `peer_challenges` row so both participants get the identical text.

### Flow

```
1. Rep texts "CHALLENGE Mike"
2. Look up "Mike" at same dealership (case-insensitive first name match against users table)
3. Ambiguity:
   - 0 matches: "No one named Mike on your team."
   - 1 match: proceed to step 4
   - 2+ matches: "Which Mike? Reply 1 for Mike S. or 2 for Mike T."
     Store pending state (see Disambiguation section below)
4. Availability checks:
   - Challenger at message cap → "You've used your training messages today. Try tomorrow."
   - Challenged at message cap → "{name}'s messages are full today. Try tomorrow."
   - Challenged on day off → "{name} is off today. Challenge someone else?"
   - Challenged in active challenge → "{name} already has a challenge going."
   - Self-challenge → "You can't challenge yourself."
   - Daily challenge day → "Today is a team challenge day. Try peer challenge tomorrow."
5. Create peer_challenges row (status = 'pending')
6. SMS to challenged: "{challenger} challenged you! Same scenario, head-to-head.
   Reply ACCEPT to play or PASS to skip."
7. SMS to challenger: "Challenge sent to {name}. Waiting for their response."
```

### ACCEPT / PASS Handling

**Keyword rules:**
- Only trigger if the ENTIRE message body is "ACCEPT" or "PASS" (case-insensitive, trimmed)
- Only trigger if sender has a `peer_challenges` row with `status = 'pending'` AND `challenged_id = sender`
- If no pending challenge exists for this sender: ignore keyword, route to normal training

**On ACCEPT:**
1. Update status → 'active', set `accepted_at`
2. Generate scenario (see Scenario Selection above)
3. Store `scenario_text` and `grading_rubric` on the peer_challenges row
4. Send identical scenario to both participants
5. Both create `conversation_sessions` linked to the peer_challenge

**On PASS (or no response in 1 hour):**
1. Update status → 'declined' (PASS) or 'expired' (timeout)
2. Notify challenger: "{name} passed. Your scenario counts as regular training today."
3. Challenger's scenario still gets graded normally (converts to regular training)

### Message Budget

**Challenger receives 3 messages:**
1. "Challenge sent to Mike. Waiting for their response." (confirmation)
2. Scenario text (after Mike accepts)
3. Combined grading + results

**Challenged receives 3 messages:**
1. "{Name} challenged you! Reply ACCEPT or PASS." (notification)
2. Scenario text (after accepting)
3. Combined grading + results

**Grading + results combined in one SMS.** To fit in 2 segments (320 chars GSM-7):
```
Challenge result: You {score}%, {opponent} {score}%.
{winner} wins. Your strength: {best_dimension}.
Work on: {weakest_dimension}.
```

Abbreviated coaching — not full detailed feedback. If the rep wants the full breakdown, they can check their training history on the dashboard or ask Coach Mode.

**A challenge day IS training for both.** Skip their regular adaptive/chain content.

### Disambiguation State

```sql
-- Part of peer_challenges table
ALTER TABLE peer_challenges ADD COLUMN disambiguation_options JSONB;
-- Structure: [{ "option": 1, "user_id": "uuid", "display": "Mike S." }, ...]
```

When disambiguation is needed:
1. Create `peer_challenges` row with `status = 'disambiguating'`
2. Store options in `disambiguation_options`
3. When challenger replies with a number:
   - Check for pending disambiguation challenge
   - Resolve to the selected user
   - Update status → 'pending', proceed to availability checks
4. Timeout: 10 minutes. "Challenge timed out. Try again with full name."
5. Non-numeric reply during disambiguation: cancel, route to training normally

### Migration

```sql
CREATE TABLE peer_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  challenger_id UUID NOT NULL REFERENCES users(id),
  challenged_id UUID REFERENCES users(id),     -- NULL during disambiguation
  scenario_text TEXT,                           -- Populated on ACCEPT
  grading_rubric JSONB,
  taxonomy_domain TEXT,
  challenger_session_id UUID REFERENCES conversation_sessions(id),
  challenged_session_id UUID REFERENCES conversation_sessions(id),
  challenger_score DECIMAL,
  challenged_score DECIMAL,
  winner_id UUID REFERENCES users(id),
  disambiguation_options JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('disambiguating', 'pending', 'active', 'completed', 'expired', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '4 hours')
);

CREATE INDEX idx_peer_challenges_active
  ON peer_challenges(status, expires_at)
  WHERE status IN ('disambiguating', 'pending', 'active');
CREATE INDEX idx_peer_challenges_challenger
  ON peer_challenges(challenger_id, created_at DESC);
CREATE INDEX idx_peer_challenges_challenged
  ON peer_challenges(challenged_id, status)
  WHERE status = 'pending';
```

### Completion + Results Assembly

Both participants grade independently through normal conversation_session flow. After BOTH sessions complete:

1. Compare scores
2. Determine winner (higher average across dimensions; earliest response breaks ties)
3. Update peer_challenges: scores, winner_id, status = 'completed'
4. Send results SMS to both (message 3 of 3)
5. Post to leaderboard with "challenge" badge/tag

**If only one responds within 4 hours:** Winner by default. "{name} didn't respond. You win by default. Your score: {score}%."

**Race condition protection:** Use advisory lock on `peer_challenges.id` when assembling results. Both sessions may complete within seconds of each other.

### Expiry Handling

Piggyback on `orphaned-sessions` cron (runs every 30 min). Add check:

```sql
SELECT * FROM peer_challenges
WHERE status IN ('disambiguating', 'pending', 'active')
AND expires_at < now();
```

- `disambiguating` expired → cancel, notify challenger
- `pending` expired (challenged never accepted) → cancel, notify challenger, convert challenger's scenario to regular training
- `active` expired (one didn't respond) → winner by default, notify both

### Feature Flag

```sql
INSERT INTO feature_flags VALUES ('{dealership_id}', 'peer_challenge_enabled', false, NULL);
```

---

## Cron Budget

| Cron Route | Schedule | Phase | Purpose |
|------------|----------|-------|---------|
| 6 existing crons | various | 2-3 | See Appendix C |
| `/api/cron/challenge-results` | `0 * * * *` (hourly) | 6 | Daily challenge EOD at 5pm local |

**Total: 7 of 40.** Peer challenge expiry piggybacks on orphaned-sessions cron. Manager quick-create integrates into training-trigger cron. Chains integrate into training-trigger cron.

---

## Feature Flags

| Flag | Default | Config | Feature |
|------|---------|--------|---------|
| `scenario_chains_enabled` | `false` | — | 3-day progressive chains |
| `daily_challenge_enabled` | `false` | `{"frequency":"mwf"}` | Shared daily challenge |
| `peer_challenge_enabled` | `false` | — | CHALLENGE keyword |
| `manager_quick_create_enabled` | `false` | — | TRAIN: keyword |

---

## Acceptance Criteria

### 6A — Manager Quick-Create
- [ ] Manager texts "TRAIN: [idea]" → AI generates scenario with rubric
- [ ] System confirms + offers "Reply NOW"
- [ ] NOW reply within 30 min pushes immediately
- [ ] NOW state tracked per manager, expires after 30 min
- [ ] No NOW → scenario queued for next training window
- [ ] Manager scenario has highest priority in training cron
- [ ] TRAIN: only works for manager/owner roles
- [ ] Feature flag gates the feature

### 6B — Daily Challenge
- [ ] Morning: reps receive shared scenario + yesterday's top 3
- [ ] Challenge topic matches morning meeting script's coaching focus
- [ ] Challenge replaces (not supplements) regular training
- [ ] EOD: responses ranked, results texted
- [ ] Configurable frequency (daily, mwf, tue_thu)
- [ ] Zero/few responses handled gracefully
- [ ] Sessions linked to challenge via challenge_id
- [ ] New cron: challenge-results (hourly, 5pm local)
- [ ] No emoji in SMS
- [ ] Feature flag gates the feature

### 6C — Scenario Chains
- [ ] 3-day chain completes with narrative continuity
- [ ] Day 2 branches based on Day 1 grading scores (deterministic)
- [ ] Day 3 branches based on Day 2 grading scores
- [ ] Chain context maintained across days
- [ ] Chain pauses on off days (no expiry increment)
- [ ] Chain pauses on challenge days (no expiry increment)
- [ ] Missed step on work day: retry next day, expire after 3 work days
- [ ] Chain completion sends summary with score progression
- [ ] Active chain at priority #3 in training cron
- [ ] 5-8 chain templates generated + reviewed
- [ ] Branching is rule-based, not LLM-decided
- [ ] Feature flag gates the feature

### 6D — Peer Challenge
- [ ] "CHALLENGE [name]" triggers flow (under 40 chars)
- [ ] Name disambiguation: 0/1/2+ matches handled
- [ ] ACCEPT/PASS keywords only trigger with pending challenge
- [ ] Both receive identical scenario from challenger's weak domain
- [ ] Results combined with abbreviated coaching in one SMS
- [ ] 4-hour expiry: no-show = default win
- [ ] Challenge = training for both (consumes message cap)
- [ ] Blocked: self-challenge, off-day, at-cap, during daily challenge
- [ ] Active chain pauses during peer challenge
- [ ] Leaderboard shows challenge results
- [ ] Advisory lock prevents race condition on result assembly
- [ ] Feature flag gates the feature

---

## Files to Create

```
supabase/migrations/YYYYMMDDHHMMSS_phase6_growth.sql
src/app/api/cron/challenge-results/route.ts
src/lib/training/content-priority.ts             — Single function: priority order for cron
src/lib/challenges/daily.ts                      — Generate + rank daily challenges
src/lib/challenges/peer.ts                       — Peer matching, acceptance, results
src/lib/chains/lifecycle.ts                      — Start/continue/branch/complete/expire
src/lib/chains/branching.ts                      — Deterministic branch selection
src/lib/chains/templates.ts                      — Template loading + variable substitution
src/lib/manager-create/generate.ts               — AI scenario generation from manager text
src/types/challenges.ts
src/types/chains.ts
scripts/generate-chain-templates.ts              — LLM-assisted template generation
```

## Files to Modify

```
src/app/api/webhooks/sms/[active-route]          — TRAIN:, CHALLENGE, ACCEPT, PASS, NOW keywords
src/app/api/cron/training-trigger/route.ts       — Use content-priority.ts for selection
src/app/api/cron/daily-digest/route.ts           — Coordinate challenge topic with morning script
src/app/api/cron/[orphaned-sessions-route]       — Peer challenge expiry check
src/lib/feature-flags.ts                         — 4 new flags
```

## Do NOT

- Use emoji in any SMS (GSM-7 only)
- Send challenges IN ADDITION to training (challenges replace)
- Make branching LLM-driven (deterministic rules, LLM generates text from selected branch)
- Build a chain template editor UI (seed script + JSON editing)
- Build a peer challenge dashboard UI (SMS-only for MVP, results on leaderboard)
- Let peer challenges overlap with daily challenges
- Exceed 3 messages/day for any feature combination
- Create more than 1 new cron slot
- Scatter content priority logic across feature modules (single function in content-priority.ts)
- Store NOW confirmation state anywhere other than the manager_scenarios row
- Increment chain expiry counter on off days or challenge days (only work days with no response)
- Generate full detailed grading feedback in peer challenge results SMS (abbreviated only)
