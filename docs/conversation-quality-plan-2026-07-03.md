# Conversation Quality Plan — 2026-07-03

## Root Cause of "Garbage" Sessions

- OpenAI account quota exhausted. Every API call returns HTTP 429 "You exceeded your current quota" — both models, confirmed in Vercel logs 08:21 UTC via new `openai.followup.http_error` logging.
- Every follow-up in every test session today served the template fallback line ("I appreciate that, but I'm still not sure...").
- The answer-conditional Q2/Q3 engine (commit 87ec314) has NEVER executed. All conversation-quality judgments so far were judgments of the dead-fallback path.
- Grading is also failing on 429 → sessions get template grades or error SMS.

## Phase 0 — Restore Service (Ken, ~5 min) — BLOCKS EVERYTHING

1. Go to platform.openai.com → Settings → Billing.
2. Add credits (or raise the monthly budget limit if it was hit).
3. Enable auto-recharge so this cannot silently kill production again.
4. Verify: send one training session; check Vercel logs show NO `openai.followup.http_error` events.

## Phase 1 — First Real Test of the Conditional Engine

Run after Phase 0. This is the first time the new prompts will execute.

- Test A (strong path): answer Q1 with a specific number/fact → expect brief acknowledgment + pivot to NEW topic; strong Q2 answer → expect Q3 to move toward a close ("could I take one home this weekend?").
- Test B (weak path): answer Q1 vaguely → expect simpler same-topic retry, no pressure escalation.
- Test C (mixed): weak Q1, strong Q2 → expect retry then pivot.
- Log check after each: zero `openai.followup.*` errors, zero `generate_follow_up.fallback` warnings.

## Phase 2 — Offline Eval Harness (test prompts without live SMS)

Closes the standing gap vs project rule "no prompt in production without an eval script."

- `scripts/eval-followups.ts`: scenario bank (10 scenarios across price/trade-in/competitor/product/financing/reliability) × {strong, weak} canned employee answers × {Q2, Q3}.
- Judge criteria per generated follow-up:
  - Strong answer → topic CHANGED, 1-5 word acknowledgment present
  - Weak answer → same topic, simpler angle, tone neutral-or-softer
  - Never re-asks an answered question; never escalates; never summarizes the correct answer back
  - 1-3 sentences, texting register, plain ASCII
- LLM-as-judge pass/fail + manual spot check. Run before deploying any prompt or model change.
- Also reuse for model upgrades (OPENAI_MODEL_PRIMARY swaps) to catch calibration drift.

## Phase 3 — Conversation Design Upgrades (data-driven, post-eval)

Priority order, each gated on eval results showing it is needed:

1. Persona continuity — verify mood/situation persists across all three turns (plumbing exists via `personaMood`; confirm it reaches Q3).
2. Grading feedback references the conversation ARC (how the rep handled Q1→Q3 progression), not just the final message.
3. Scenario openers reviewed for follow-up potential — openers that can only be answered one way produce forced follow-ups.
4. Optional: end-of-session one-line recap SMS ("Strong on the apology, work on pivoting to next steps") if arc-grading lands well.

## Phase 4 — Degraded-Mode + Observability Hardening

1. DONE (this commit): fallback line bank — mode/step-aware natural customer lines (universal pivots: payments, financing, warranty, trade-in) replacing the single badgering "I'm still not sure" line; random selection, no repeat within a session's two follow-ups.
2. Sentry alert rule on `openai.followup.http_error` + `openai.grading.http_error` (any 429 = quota emergency, notify immediately).
3. Low-balance guard: extend an existing cron to hit OpenAI usage API (or track cumulative cost in `ai_costs`) and SMS/email Ken before quota death.
4. If slow generations appear post-restore: raise `OPENAI_TIMEOUT_MS` env var (default 10000) to 15000-20000. No code change needed.

## Success Criteria

- Live session with zero fallback lines; Q2 visibly reacts to answer quality; Q3 is a new topic; strong runs end in a closing test.
- Eval harness ≥90% judge-pass across the scenario bank.
- Quota exhaustion becomes a paged alert, not a silent product failure.

## Evidence Trail

- 04:47 + 07:58 UTC sessions: `openai.generate_follow_up.fallback` (cause invisible — pre-logging).
- 08:21 UTC session: `openai.followup.http_error` status=429 on gpt-5.4-2026-03-05 AND gpt-4o-mini-2024-07-18, followed by fallback warn. Deploy dpl_5RGV25np (450a9bb).
- Token-budget fix (200→1000, d703843) remains correct defensive work but was not the active failure.
