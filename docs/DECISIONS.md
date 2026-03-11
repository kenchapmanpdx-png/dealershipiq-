# Decisions Log

Append-only. Each entry records a technical or product decision with rationale.

## D-001: Sinch XMS REST API for outbound SMS
- **Date:** 2026-03-10
- **Decision:** Use Sinch XMS REST API (`/xms/v1/{servicePlanId}/batches`) instead of Conversation API REST wrapper for outbound SMS.
- **Rationale:** Conversation API wrapper returned delivery failure code 61 (unroutable). XMS direct call works. Simpler auth (Bearer token vs HMAC signing).
- **Affected files:** `src/lib/sms.ts`

## D-002: Sinch Conversation API for inbound webhooks
- **Date:** 2026-03-10
- **Decision:** Keep Sinch Conversation API webhook for inbound message processing.
- **Rationale:** Already configured, HMAC verification working. Inbound path works fine — only outbound was broken.
- **Affected files:** `src/app/api/webhooks/sms/sinch/route.ts`

## D-003: GPT-5.4 as primary AI model
- **Date:** 2026-03-10
- **Decision:** Primary model `gpt-5.4-2026-03-05` for grading, training content generation, manager content, scenario chains. Fallback `gpt-4o-mini-2024-07-18`. Keep `gpt-4o-mini` for daily-challenge and peer-challenge (speed > quality).
- **Rationale:** User requested upgrade. GPT-5.4 produces better coaching feedback and more natural customer voice.
- **Affected files:** `src/lib/openai.ts`, `src/lib/manager-content-create.ts`, `src/lib/scenario-chains.ts`

## D-004: max_completion_tokens for GPT-5.x models
- **Date:** 2026-03-10
- **Decision:** Use `tokenLimitParam()` helper that sends `max_completion_tokens` for GPT-5.x models and `max_tokens` for older models.
- **Rationale:** GPT-5.4 API rejects `max_tokens` with 400 error. Backward compat needed for gpt-4o-mini fallback.
- **Affected files:** `src/lib/openai.ts`

## D-005: Never Naked feedback format
- **Date:** 2026-03-10
- **Decision:** All grading feedback follows Never Naked format: `[score]/10 ⭐ What worked: [...] Level up: [...] 💡 Pro tip: "[exact phrase]"`
- **Rationale:** User feedback — grading was too vague, didn't name specific techniques or stats. Never Naked = every score has context, every critique has a fix.
- **Affected files:** `src/lib/openai.ts` (GRADING_SYSTEM_PROMPT)

## D-006: No meta-framing in training questions
- **Date:** 2026-03-10
- **Decision:** Training questions sent as raw customer speech. No "DealershipIQ Training:", no "Reply with your best sales response!", no labels.
- **Rationale:** User feedback — meta-framing breaks immersion. Trainees should feel like they're responding to a real customer.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`

## D-007: No product fact hallucination in grading
- **Date:** 2026-03-10
- **Decision:** Grading system prompt explicitly forbids citing specific vehicle features, specs, or comparisons unless provided in the prompt context.
- **Rationale:** User feedback — AI was grading on made-up vehicle specs. "Elaborate more on the CR-V's unique features" when no feature list was given.
- **Affected files:** `src/lib/openai.ts` (GRADING_SYSTEM_PROMPT)

## D-008: 3-exchange multi-exchange state machine
- **Date:** 2026-03-10
- **Decision:** All training modes use 3 exchanges before grading. `step_index` 0→1→2 on `conversation_sessions`. Mode-specific behavior: objection (progressive coaching + escalation), roleplay (no mid-coaching, customer escalates), quiz (3 different questions).
- **Rationale:** Single-exchange sessions were too shallow. Real sales conversations have back-and-forth.
- **Affected files:** `src/lib/state-machine.ts`, `src/lib/openai.ts`, `src/app/api/webhooks/sms/sinch/route.ts`

## D-009: Quiet hours — send windows
- **Date:** 2026-03-10
- **Decision:** Mon-Sat 10AM-7PM, Sun 11AM-7PM local time. Grading feedback and Ask IQ exempt (respond immediately regardless of time).
- **Rationale:** TCPA compliance. Don't wake people up. But don't delay feedback when someone just texted you.
- **Affected files:** `src/lib/quiet-hours.ts`, `src/app/api/webhooks/sms/sinch/route.ts`

## D-010: Weekday-only training with configurable send hour
- **Date:** 2026-03-10
- **Decision:** Daily training cron skips weekends. `training_send_hour` stored in dealership `settings` JSONB (default 10, range 9-12).
- **Rationale:** Salespeople don't want training texts on weekends. Per-dealership hour lets managers align with their schedule.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`, `src/lib/service-db.ts`, `src/lib/quiet-hours.ts`

## D-011: Supabase project consolidation
- **Date:** 2026-03-10
- **Decision:** All env vars point to single Supabase project `nnelylyialhnyytfeoom`. Old projects `hbhcwbqxiumfauidtnbz` and `bjcqstoekfdxsosssgbl` deprecated.
- **Rationale:** Three different Supabase URLs in Vercel env vars caused silent data loss. Webhook wrote to one DB, grading read from another.
- **Affected files:** Vercel env vars only

## D-012: Vercel Hobby plan — cron and deploy constraints
- **Date:** 2026-03-10
- **Decision:** Accept Hobby plan limits: max 1x/day cron frequency, env vars baked at deploy time (changes require redeploy), no serverless concurrency control.
- **Rationale:** Sufficient for current phase. Upgrade to Pro when load requires it.
- **Affected files:** `vercel.json`
