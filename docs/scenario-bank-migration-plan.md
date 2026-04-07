# DealershipIQ — Scenario Bank Migration Plan
## elite_response → technique_tag + elite_dialogue + fail_signals
## Version 1.0 | April 2026

---

## Data Inventory (verified line-by-line)

| Metric | Count | Verified |
|---|---|---|
| Total scenarios | 217 | grep + python sequence check |
| Complete sequence 001-217 | YES | Zero gaps, zero duplicates |
| All 6 fields populated | 217/217 | Zero missing fields |
| Mode: objection | 144 | |
| Mode: roleplay | 38 | |
| Mode: quiz | 35 | |
| Mode total | 217 | Matches |
| Domain: closing_technique | 71 | |
| Domain: product_knowledge | 48 | |
| Domain: objection_handling | 46 | |
| Domain: financing | 41 | |
| Domain: competitive_positioning | 11 | |
| Domain total | 217 | Matches |
| Difficulty: 1 | 83 | |
| Difficulty: 2 | 125 | |
| Difficulty: 3 | 9 | |
| Difficulty total | 217 | Matches |

## Content Pattern Analysis (verified line-by-line)

### What exists in the current elite_response field

**209 of 217** scenarios start with an ALL CAPS technique tag (e.g., AGREE then REFRAME, ISOLATE then PROPOSAL). The 8 that don't are all quiz scenarios that begin with factual content or "Must know..." / "Must name..." / "Three distinct approaches..." phrasing.

**155 of 217** scenarios contain extractable dialogue — quoted speech of 50+ characters already embedded in the elite_response. Breakdown:

| Mode | Total | Has extractable dialogue | Needs new dialogue |
|---|---|---|---|
| Objection | 144 | 102 | 42 |
| Roleplay | 38 | 30 | 8 |
| Quiz | 35 | 23 | 12 |
| **Total** | **217** | **155** | **62** |

**8 scenarios** exceed 500 characters (013, 126, 145, 151, 152, 163, 206, 207). Range: 507-558 chars. The split into two fields actually helps these — neither field needs to carry both coaching and dialogue.

**191 of 217** elite_responses contain em-dashes (Unicode \u2014). **108 of 155** extractable dialogue snippets contain em-dashes. This is a critical SMS issue: em-dashes force UCS-2 encoding, cutting SMS limits from 160 to 70 chars per segment and tripling cost. All em-dashes in the elite_dialogue column must be replaced.

**All 217** fail_signals are under 200 chars (max 160, avg 117). Zero work needed on fail_signals.

### Quiz mode is NOT uniform

The 35 quiz scenarios fall into two distinct sub-types:

**Sub-type Q1 — Technique-based quiz (26 scenarios):** These have technique tags AND embedded dialogue. They test sales skills framed as knowledge questions. Example: "What's the first thing you say when a customer says 'I need to think about it'?" → AGREE then ISOLATE + sample dialogue.

- IDs: 057, 058, 059, 061, 062, 063, 064, 065, 066, 067, 068, 069, 070, 072, 079, 080, 200, 201, 202, 203, 204, 205, 206, 207 + 060, 199 (have short quotes)

**Sub-type Q2 — Pure knowledge recall (9 scenarios):** No technique tag, no dialogue. Test pure factual knowledge. Example: "What's the difference between AWD and 4WD?"

- IDs: 056, 071, 073, 074, 075, 076, 077, 078, 198

**Decision required:** Sub-type Q1 should get a real technique_tag (same as objection/roleplay), NOT a blanket `KNOWLEDGE_CHECK`. Sub-type Q2 gets `KNOWLEDGE_CHECK` because there's genuinely no sales technique to evaluate — just factual accuracy.

---

## The Three Output Columns

### technique_tag

**Purpose:** Tells the AI grader what strategy to reward. Flexible — any response that executes this family of approaches scores well.

**Format rules:**
- 80-150 characters
- Starts with named technique in ALL CAPS (e.g., AGREE THEN REFRAME)
- Followed by a brief description of what the strategy means
- Must be flexible — describes the approach, not specific words
- Does NOT contain sample dialogue or quoted speech
- Does NOT contain fail signals (those are in their own column)
- For Q2 quiz scenarios: `KNOWLEDGE_CHECK` + brief description of required facts

**Source:** Extracted from the first portion of the existing elite_response. 209/217 already start with this pattern. The remaining 8 need technique tags written.

### elite_dialogue

**Purpose:** Seeds the AI's `example_response` output — the "here's what you should have said" line sent to the rep via SMS. Must be concrete words a real salesperson would say.

**Format rules:**
- 150-200 characters (hard limit — seeds the 200-char output field)
- Written as actual dialogue — words a rep would text or say
- Must sound like a real person, not a textbook
- Must execute the technique described in technique_tag
- Must be factually accurate — no made-up warranty terms, rates, or specs
- NO em-dashes (\u2014) — replace with " -- " or rephrase
- NO curly quotes — use straight quotes only
- NO emoji, NO non-GSM-7 characters
- Must be a single continuous statement (not multiple exchanges)
- For Q2 quiz scenarios: the concise factual reference answer

**Source:** 155 scenarios have extractable dialogue (50+ char quotes). These need extraction, cleanup, GSM-7 compliance, and trimming to 200 chars. 62 scenarios need new dialogue written from scratch.

### fail_signals

**Purpose:** Tells the AI grader what specific behaviors to penalize.

**Format rules:** Already defined and complete. All 217 populated, all under 200 chars. **No work needed.**

---

## Migration Process

### Phase 0: Setup and tooling

Before touching any content:

1. Copy the scenario bank file to a working directory
2. Create a tracking spreadsheet with columns: scenario_id, mode, domain, difficulty, category (A/B/Q1/Q2), technique_tag_status, elite_dialogue_status, validation_status
3. Pre-populate category for all 217 scenarios based on the classification data above

**Checkpoint 0:** Tracking spreadsheet has 217 rows. Category counts match: A=49, B=133, Q1=26, Q2=9. Total=217.

### Phase 1: technique_tag extraction (all 217 scenarios)

**What:** Extract the coaching direction from each elite_response into a standalone technique_tag.

**Process for Category A + B (182 objection/roleplay):**
- Copy the ALL CAPS technique name and the 1-2 sentence coaching direction that follows it
- Strip out any quoted dialogue
- Trim to 80-150 chars
- Verify it describes a strategy family, not specific words

**Process for Sub-type Q1 (26 quiz with technique):**
- Same as above — these already have technique tags

**Process for Sub-type Q2 (9 pure knowledge quiz):**
- Write: `KNOWLEDGE_CHECK. [brief description of required facts]`
- Example for 056: `KNOWLEDGE_CHECK. Must distinguish AWD (automatic, all-weather, comfort/safety) from 4WD (selectable, transfer case, off-road/towing capability).`

**Batch order:** Process in groups of 30, by scenario number, to maintain sequential focus.

| Batch | Scenarios | Count | Category mix |
|---|---|---|---|
| 1-1 | 001-030 | 30 | All objection (A or B) |
| 1-2 | 031-060 | 30 | Roleplay 031-055 + Quiz 056-060 |
| 1-3 | 061-090 | 30 | Quiz 061-080 + Objection 081-090 |
| 1-4 | 091-120 | 30 | All objection |
| 1-5 | 121-150 | 30 | Objection + some roleplay |
| 1-6 | 151-180 | 30 | Objection |
| 1-7 | 181-217 | 37 | Mixed: roleplay, quiz, objection |

**Checkpoint 1 (per batch):**
- [ ] Every scenario in the batch has a technique_tag
- [ ] All technique_tags are 80-150 chars
- [ ] No technique_tag contains quoted dialogue
- [ ] No technique_tag contains fail signals
- [ ] Q2 scenarios start with KNOWLEDGE_CHECK
- [ ] technique_tag accurately represents what the original elite_response was teaching

**Checkpoint 1-FINAL (after all 7 batches):**
- [ ] 217/217 technique_tags populated
- [ ] Zero technique_tags under 80 chars
- [ ] Zero technique_tags over 150 chars
- [ ] Spot-check 30 random scenarios (every 7th one) for accuracy

### Phase 2: elite_dialogue extraction and creation (all 217 scenarios)

This is the critical phase. Two different processes depending on whether dialogue already exists.

**Process for 155 scenarios with extractable dialogue:**

1. Find the longest quoted dialogue in the elite_response (already mapped above)
2. Extract it
3. Clean it:
   - Replace em-dashes (\u2014) with " -- " or rephrase to avoid them
   - Replace curly quotes with straight quotes
   - Remove any non-GSM-7 characters
4. Check length:
   - If 150-200 chars: use as-is after cleanup
   - If over 200 chars: trim to 200 while preserving meaning and completeness
   - If under 150 chars: expand slightly to meet minimum (add a closing question or next step)
5. Verify it executes the technique from the technique_tag
6. Verify factual accuracy — no invented warranty terms, rates, or vehicle specs

**Process for 62 scenarios needing new dialogue:**

1. Read the full original elite_response carefully
2. Read the technique_tag (already created in Phase 1)
3. Write a new 150-200 char dialogue snippet that:
   - Executes the technique
   - Sounds like a real salesperson (not a textbook)
   - Contains zero non-GSM-7 characters
   - Includes either a question or a specific next step
   - Contains no made-up facts
4. Cross-check against fail_signals — the elite_dialogue should NOT trigger any of the fail signals

**Batch order:** Same 7 batches as Phase 1.

**Checkpoint 2 (per batch):**
- [ ] Every scenario in the batch has an elite_dialogue
- [ ] All elite_dialogues are 150-200 chars
- [ ] Zero em-dashes in any elite_dialogue
- [ ] Zero curly quotes in any elite_dialogue
- [ ] Zero non-GSM-7 characters (run automated check)
- [ ] Each elite_dialogue executes the technique from the technique_tag
- [ ] No elite_dialogue triggers any of its own fail_signals
- [ ] No made-up facts (warranty terms, rates, specs) — flag any for review

**Checkpoint 2-FINAL (after all 7 batches):**
- [ ] 217/217 elite_dialogues populated
- [ ] Zero under 150 chars
- [ ] Zero over 200 chars
- [ ] Zero non-GSM-7 characters (automated scan of entire column)
- [ ] Voice consistency check: read 20 random elite_dialogues in sequence — do they sound like the same person?

### Phase 3: Cross-validation (all 217 scenarios)

Final integrity pass. Every scenario checked against every other field.

**Per-scenario checklist (all 217):**

| # | Check | How |
|---|---|---|
| 1 | technique_tag exists | Not null, not empty |
| 2 | technique_tag is 80-150 chars | len() check |
| 3 | elite_dialogue exists | Not null, not empty |
| 4 | elite_dialogue is 150-200 chars | len() check |
| 5 | fail_signals exists | Not null, not empty (already verified) |
| 6 | fail_signals is under 200 chars | len() check (already verified) |
| 7 | technique_tag has no quoted dialogue | No double-quote characters |
| 8 | elite_dialogue has no em-dashes | No \u2014 character |
| 9 | elite_dialogue has no curly quotes | No \u2018 \u2019 \u201c \u201d |
| 10 | elite_dialogue executes the technique | Human review |
| 11 | elite_dialogue doesn't trigger fail_signals | Human review |
| 12 | Q2 quiz technique_tag starts with KNOWLEDGE_CHECK | Mode check |
| 13 | Mode is objection, roleplay, or quiz | Enum check |
| 14 | Domain is one of the 5 valid values | Enum check |
| 15 | Difficulty is 1, 2, or 3 | Enum check |
| 16 | customer_line exists and is under 300 chars | Already verified |

Checks 1-9 and 12-16 are automated (script). Checks 10-11 require human review.

**Checkpoint 3:**
- [ ] Automated script passes all 217 scenarios on checks 1-9, 12-16
- [ ] Human review complete on checks 10-11 for all 217

### Phase 4: Output file creation

Produce the final deliverable: a new scenario bank file with all 8 fields per scenario.

**Output fields per scenario:**
1. scenario_id (001-217)
2. customer_line (unchanged)
3. technique_tag (new)
4. elite_dialogue (new)
5. fail_signals (unchanged)
6. mode (unchanged)
7. domain (unchanged)
8. difficulty (unchanged)

**Format:** Markdown file matching current bank format, plus a machine-readable CSV for database import.

**Checkpoint 4:**
- [ ] Output file has exactly 217 scenarios
- [ ] Sequence 001-217 complete, no gaps, no duplicates
- [ ] All 8 fields populated for every scenario
- [ ] Mode distribution: objection 144, roleplay 38, quiz 35
- [ ] Domain distribution: closing_technique 71, product_knowledge 48, objection_handling 46, financing 41, competitive_positioning 11
- [ ] Difficulty distribution: 1=83, 2=125, 3=9
- [ ] Diff against original bank: customer_line, fail_signals, mode, domain, difficulty are UNCHANGED for every scenario
- [ ] Original elite_response preserved in a separate archive column or file (never delete the original)

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Dialogue factual errors | Reps trained on wrong info | Flag any dialogue mentioning specific warranty terms, rates, loan lengths, or vehicle specs for manual fact-check |
| Voice inconsistency | Product feels disjointed | Do voice calibration on first 10 dialogues, use as reference for remaining 207 |
| Em-dash replacement introduces awkward phrasing | Dialogue sounds unnatural | Read aloud test — if replacement sounds wrong, rephrase the entire sentence instead of find-and-replace |
| Technique tag too vague | Grader can't calibrate | Each technique_tag must name at least ONE specific action (e.g., "shift to total deal value" not just "reframe") |
| Technique tag too specific | Grader penalizes valid alternatives | Each technique_tag must describe a strategy family, not one exact script |
| Dialogue doesn't match technique | Grader gets contradictory signals | Cross-validation check 10 catches this |
| Dialogue triggers fail_signals | Grader gets contradictory signals | Cross-validation check 11 catches this |
| Q1 quiz scenarios miscategorized as Q2 | Wrong grading mode applied | Verify: if a quiz scenario has a technique tag other than KNOWLEDGE_CHECK, the question must actually test a skill (not just facts) |
| Original data lost during migration | Unrecoverable | Archive original elite_response in separate file before any modifications |

---

## Work Estimates

| Phase | Scenarios | Work type | Estimated effort |
|---|---|---|---|
| Phase 0: Setup | — | Tooling | 1 hour |
| Phase 1: technique_tag extraction | 217 | Semi-mechanical | 3-4 hours |
| Phase 2: elite_dialogue (extractable) | 155 | Extract + clean + GSM-7 fix | 5-6 hours |
| Phase 2: elite_dialogue (new) | 62 | Creative writing | 4-5 hours |
| Phase 3: Cross-validation | 217 | Automated + human review | 2-3 hours |
| Phase 4: Output file | 217 | Assembly + final check | 1-2 hours |
| **Total** | | | **16-21 hours** |

---

## What I got wrong in the first plan

1. **Estimated ~180 scenarios need dialogue written from scratch.** Actual: 62. The other 155 already have extractable dialogue embedded in the elite_response. This cuts the creative work by ~65%.

2. **Called quiz mode "the easiest."** Actual: 26 of 35 quiz scenarios are technique-based with embedded dialogue — they're structurally identical to objection/roleplay scenarios. Only 9 are pure knowledge recall.

3. **Didn't flag the GSM-7 character issue with sufficient urgency.** 108 of 155 extractable dialogue snippets contain em-dashes that would triple SMS costs if left uncleaned. This is a hard blocker, not a nice-to-have.

4. **Proposed blanket KNOWLEDGE_CHECK for all 35 quiz scenarios.** Wrong. Only 9 qualify. The other 26 test sales techniques and need real technique_tags with flexible grading criteria, same as objection/roleplay.

5. **Proposed batch order by mode (quiz first, then objection, then roleplay).** Revised: batch by scenario number (001-030, 031-060, etc.) to maintain sequential focus and make checkpoint verification simpler.
