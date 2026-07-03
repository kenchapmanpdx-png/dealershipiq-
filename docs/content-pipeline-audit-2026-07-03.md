# Content Pipeline Audit — Wire to Wire — 2026-07-03

Scope: everything that determines question/answer quality. Scenario sourcing → persona → Q1 → follow-ups (Q2/Q3) → grading → feedback SMS.

## The Wire (current reality)

```
daily-training cron ─┐
GO keyword ──────────┤
                     ├─ selectTrainingContent(userId)
                     │    ├─ selectTrainingDomain()   ← adaptive weighting (rep's weak areas)
                     │    ├─ mode: RANDOM of 3
                     │    ├─ selectPersonaMood()      ← tier system + setupHint + promptModifier
                     │    └─ getVehicleContextForScenario() ← real trims, brand-filtered
                     │         (vehicle_data_enabled flag)
                     ▼
              *** DISCARDED *** ← domain prompt, mood modifier, vehicle context all thrown away
                     ▼
              getRandomScenario(mode) ← static pool, 10 lines/mode, DOMAIN-BLIND
                     ▼
              Q1 SMS → rep answers → generateFollowUp (Q2: conditional, Q3: pivot)
                     ▼                    ← brands + mood + history [SHIPPED TODAY]
              gradeResponse (v7 templates if bank entry matched by ILIKE on customer_line)
                     ▼
              480-char feedback SMS (Q1/Q2/Q3 word tracks)
```

## Findings (priority order)

### F1 — CRITICAL: Adaptive domain selection never reaches the question
- `selectTrainingDomain` picks the rep's weakest domain; `getRandomScenario(mode)` ignores it.
- Weak-on-financing rep gets a financing Q1 ~10% of the time by chance.
- Session is TAGGED with the domain → grading weights + priority vector update as if domain training happened. Adaptive loop learns from mislabeled data.
- Fix (Phase A, deterministic): tag every SCENARIO_POOL entry with domain; `getRandomScenario(mode, domain)` filters domain-first, mode-fallback. Expand pool to ≥4 scenarios per domain×mode (5 domains × 3 modes). Keep objection entries aligned with scenario-bank customer_lines so v7 grading metadata still matches.
- Fix (Phase B, dynamic): AI-generate Q1 from domain+mood+brand+vehicle context (pattern already exists in manager-create/generate.ts), static pool as fallback. Feature-flag gated. Requires eval harness first.

### F2 — HIGH: 30 static Q1 lines total → repetition kills value
- 10/mode; trainee mode = 3 sessions/day → repeats within ~2 weeks; recognizable scenarios = rehearsed answers, inflated scores.
- SCENARIO_POOL duplicated in sinch/route.ts AND cron/daily-training/route.ts — drift risk, fix in both or extract shared module.
- Phase B (generated Q1) is the durable fix; pool expansion is the bridge.

### F3 — HIGH: Vehicle-data machinery is built, brand-safe (H-016), and unused in the live path
- getVehicleContextForScenario returns real trims for the dealership's brands; formatVehiclePrompt exists; output discarded (see F1).
- When wired into Phase B: product-knowledge questions about ACTUAL lot inventory ("2026 CR-V EX-L hybrid — customer asks real-range question"). This is the differentiator dealerships pay for.
- Dependency: `vehicle_data_enabled` flag + seeded vehicle data (scripts/seed-vehicle-data.py) — verify per dealership.

### F4 — HIGH: Grader credibility calibration (from 12/20 session review)
- Concrete next-step offer ("let's pencil out both options") graded as "dodge" while the suggested word track was a paraphrase of it. Rule needed: proposing an immediate concrete next step = advancing, not dodging, even without a number.
- Arc-awareness: grader has full history but doesn't coach "you collected discovery info and didn't USE it" (the real A2 lesson).
- BLOCKED ON: eval harness (scripts/eval-followups.ts + eval-grading.ts). Grader prompt changes must not ship blind.

### F5 — MEDIUM: Follow-up latency → fallback quality cliff
- gpt-5.4 default (medium) reasoning + 10s OPENAI_TIMEOUT_MS → timeouts fall back to gpt-4o-mini-2024-07-18 (2-year-old model) or canned line. Every fallback is a quality cliff mid-conversation.
- FIXED IN THIS COMMIT: `reasoning_effort: 'low'` on gpt-5* follow-up calls (1-3 sentence texting lines don't need deep reasoning; cuts latency + cost). Grading keeps default effort.
- Recommend: OPENAI_MODEL_FALLBACK → a gpt-5.4-mini snapshot (verify exact ID on platform.openai.com/docs/models) once eval harness can regression-check it.

### F6 — MEDIUM: Objection-mode mid-exchange coaching is dead code
- FollowUpSchema allows optional `coaching`; the strict OpenAI JSON schema only permits `customerMessage` (additionalProperties: false) → model can never return coaching → `if (mode === 'objection' && followUp.coaching)` never fires.
- Product decision needed: (a) delete the dead branch, or (b) enable it — add coaching to the schema + prompt instruction for objection mode only. (b) is a real training feature (in-the-moment correction) but changes SMS cadence; eval + live test before enabling.

### F7 — MEDIUM: Persona/mood system underexploited
- selectPersonaMood has tiers + setupHint + promptModifier; only the mood NAME reaches follow-ups/grading ("Customer mood: hesitant").
- Fix: pass promptModifier into follow-up prompt (one line); mood then shapes HOW the customer texts, not just a label.

### F8 — LOW: Transcript hygiene for AI context
- getSessionTranscript returns ALL session-tagged rows; any outbound system line (error SMS, recovery nudge) becomes "Customer:" dialogue in AI context. Currently rare; will matter more as system messages grow. Fix: `direction` enum for system lines, filter in formatConversationForAI.

### F9 — LOW: DOMAIN_PROMPTS competitive examples hardcode Honda/Toyota/Chevy
- training-content.ts DOMAIN_PROMPTS are currently discarded (F1) so harmless today; if Phase B revives them, brand-ground them via dealershipBrands like everything else.

### F10 — HOUSEKEEPING
- Priority vector ON CONFLICT bug (missing unique constraint) — grading logs it every session; migration needed.
- Quiz pool line "towing capacity ... hauls a boat" — was the source of vague vehicle-less questions; brand rule (shipped) mitigates in follow-ups; pool rewrite in Phase A resolves at the source.
- INTERNAL_WORKER_SECRET path now inert (single-hop shipped) — either remove the two-hop code or leave gated; decide at next cleanup.

## Recommended sequence

1. **Eval harness** (scripts/eval-followups.ts + eval-grading.ts, scenario bank × strong/weak answers, LLM-judge + manual review). Unblocks F4, F5-fallback-swap, F6, Phase B. ~1 session of work.
2. **Phase A**: domain-tagged pool (fixes F1 deterministically), extract shared pool module (F2 drift), mood promptModifier pass-through (F7). CI-verifiable, no AI risk.
3. **F4 grader calibration** through the harness; regression-test on the 12/20 transcript.
4. **Phase B**: AI-generated Q1 with vehicle context (F3), flag-gated, eval-gated, pool fallback.
5. Housekeeping migration + dead-code decision (F6, F10).

## Shipped in this commit
- `reasoning_effort: 'low'` for gpt-5* follow-up generation (F5).
