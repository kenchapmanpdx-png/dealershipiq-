# Feedback on Pressure Test B — v2

Audience: the LLM/author maintaining this prompt.
Source of feedback: running v2 end-to-end on a real 130-file Next.js codebase immediately after running v1 and shipping 20+ fixes from v1. I could directly compare output quality between versions and observe which v2 changes paid off.

Summary: **v2 is materially better than v1.** Most of my v1 feedback was adopted and worked as predicted. The remaining issues are smaller and more specific.

---

## What v2 got right (keep)

### Confidence tags — highest-yield addition
`[verified]` / `[inferred]` / `[conditional]` changed my behavior in three ways:
1. Forced me to grep-verify before stamping `[verified]`. Findings I couldn't back with a quote got `[inferred]` or got dropped.
2. Gave me a place to honestly flag race conditions I couldn't prove without runtime (`[conditional]`).
3. Let downstream readers triage: `[verified]` is actionable now; `[inferred]` needs a one-line check before fixing.

Keep as-is.

### "Fix at Scale" section
Pulled 8 items out of the main severity tables that were cluttering v1 — circuit breakers, canary rollout, bounded concurrency, soak tests. They were correct findings but not actionable at this user's current scale (sub-1K dealerships). In v1 they mixed with real "user can't log in today" bugs and diluted priority.

Keep as-is. The trigger-condition column ("Implement When") made this actually useful, not just deferred.

### Issue Clusters
**This was the single most valuable new section.** It surfaced a pattern I could not have seen by reading findings individually:

- Cluster A: the whole rate-limit module has zero callers (vacuous fix).
- Cluster B: three of my yesterday's fixes share a root cause — I didn't re-audit the callers of files I modified.
- Cluster C: three separate local `normalizePhone` functions.

Clusters turn "fix 20 bugs" into "fix 5 root causes." Biggest leverage increase in v2.

Keep, and consider requiring a minimum of 3 clusters when the finding count exceeds ~15.

### Cross-file seam instruction
> "Trace data across files: for every user input that gets stored, follow it to every place it's rendered or used. For every function that returns a result, check that every caller handles the failure case. Bugs hide at the seams between files, not inside them."

Without this line, Cluster B (my own regressions) would not have surfaced. The regression in C2 only appears when you trace `quiet-hours.ts throw` to every `isWithinSendWindow(...)` caller and notice no try/catch. That's a multi-file audit, not a single-file review.

Keep, and I'd promote it from paragraph 4 to paragraph 2 — it's load-bearing.

### NOW vs FUTURE scale tag
Saved me from 🔴-flagging "circuit breakers missing" on a pre-500-user product. Distinguishing "breaks this week" from "breaks at 10K users" is the single most common LLM-audit failure mode. Keep.

### Source-quote requirement (implicit)
I read v2 as requiring evidence and enforced it on sub-agents. This killed several plausibly-wrong findings silently. Quality of surviving findings was visibly sharper than v1.

**Make this explicit, not implicit.** Add to the output format: `EVIDENCE: <2-5 line quote from source>`. Findings without it are invalid. This was in my v1 feedback; the v2 prompt still leaves it ambiguous.

### Scale Cliff
> "Scale cliff: [the lowest N where something breaks silently]"

My output landed on "500 reps per dealership" — a specific number the user can plan around. Forces the auditor to pick a number instead of waving at "it doesn't scale." Keep.

### Category 24 — Metered Resource Protection
New category, high hit rate. Would not have found the zero-call-site rate limiter without it. Keep.

### Serverless-specific guidance in Category 16
> "For serverless: skip soak tests, thread contention, instance scaling. Focus on: cold start latency, connection pool exhaustion, function timeout risk, N+1 queries."

Correct and useful. Prevents wasted effort. Consider similar short guidance blocks for: mobile, CLI, desktop, long-lived services.

### Reminder at category 12
> "REMINDER: For every category above and below — ask 'What handling is ABSENT that should be present?'"

The single most valuable sentence from v1, now repeated mid-prompt. Good placement — models lose context by category 12 and the re-anchor helps.

---

## What v2 still needs (change)

### Make EVIDENCE explicit in the output contract
Currently implied; not enforced. The output schema says:

```
| # | File:Line | Category | Tag | Issue | Failure Scenario | Fix |
```

That table has no column for the source quote. I worked around it by switching to flat records with `EVIDENCE:` inside each finding, but the prompt doesn't require that.

**Fix**: replace the table with flat records. Add `EVIDENCE` as a required field. Tables were already too narrow for 5-column data; 7 columns makes them unreadable. Flat records also allow longer code blocks in FIX.

Proposed:
```
## FINDING <id> — <severity>
FILE: src/foo.ts:12-34
CATEGORY: <name>
TAG: [verified|inferred|conditional]
SCALE: NOW | FUTURE
EVIDENCE:
    <2-5 line quote>
SCENARIO: <one sentence>
FIX:
    <code or concrete change>
```

### Require prior-fix grep-verification
When the audit is re-run after fixes, the biggest findings (C1, C2, C3, C4 in my run) were all self-inflicted regressions. The prompt should institutionalize re-checking your own work:

Add to the top-of-prompt instructions:
> **If prior fixes exist in this repo** (git log, audit docs, CHANGELOG), grep-verify that every function you recommended in a prior pass actually has callers, and every try/catch you removed isn't now swallowed by a caller that needed it. A fix that works in isolation but breaks a caller is a regression.

This single line would have made C1 and C2 unavoidable findings by process rather than by luck.

### Add a "Regression" sub-category explicitly
I had to invent "(regression from 2026-04-13 fix)" notation for C2 and C3. Consider formalizing:

```
CATEGORY: <name>
REGRESSION_OF: <prior-fix-id | none>
```

Makes it obvious when an audit found a newly-introduced bug vs a pre-existing one. Matters for blame-free root-cause analysis.

### Tighten "List every file and directory" at the top
V2 still says:
> "FIRST: List every file and directory in the project. Audit systematically — do not skip files you haven't looked at. Coverage gaps are audit failures."

This is counterproductive on a 130-file repo. I inventoried files, found I could only deeply audit ~30 of them, and felt obligated to hedge. The real-world audit is "go deep on the high-risk 20%; skim the rest; be explicit about what you skipped."

**Fix**: replace with:
> "Map the repo by risk, not by file count. Webhooks, crons, external-service clients, state machines, and money paths get deep reads. Everything else: skim and note what you skipped and why in the SKIPPED section at the top. Full coverage is not required. Refusing to skip is the audit failure; undocumented skipping is the audit failure."

You kept "SKIPPED" in the output implicit ("note what was skipped and why"). Make it a required section.

### Add an output-size budget
Output ballooned to 32 findings across 20-ish pages. A consumer (product manager, eng manager) can act on 10 cleanly; 32 becomes noise.

**Fix**: add to instructions:
> "Target: 15–30 findings total, weighted to CRITICAL and HIGH. Prefer one sharp finding over three weak variants of the same issue. Group similar findings via Issue Clusters, then report cluster + root cause instead of individual instances."

Issue Clusters already exist; this nudges the model to lean on them.

### Category 19 still leaks security concerns
> "If README, CLAUDE.md, or architecture docs exist: spot-check key claims against code. Report divergence between documented and implemented behavior"

Good. But:
> "Error types narrowed in catch blocks?"

— that's more code-quality than reliability. Consider trimming Category 19 to just:
- Dead code / stale TODOs / unused exports
- Doc-vs-code divergence
- Unused-but-exported functions (would have caught C1's dead rate-limiter by category)

Everything else → Code Quality audit.

### "Chaos mode" still under-specified
> "Chaos mode: Append `Simulate: every external dependency fails simultaneously. What survives?`"

Vague. What I'd find useful:

```
Chaos mode — simulate each failure and report:
- OpenAI down 5 minutes: <what breaks immediately, what degrades, what stays working, auto-recovery path>
- OpenAI at 10x latency (no error, just slow): <…>
- Supabase down: <…>
- Supabase schema drift (column renamed, row type changed): <…>
- Stripe webhook dropped entirely for 1 hour: <…>
- Sinch rate-limiting outbound SMS: <…>
- Upstash Redis down: <…>
- Primary region timezone DB stale: <…>
- One malformed row in a hot table: <…>
```

The last one is what caught C2 in my run. It belongs in the chaos checklist.

---

## What v2 should remove

### Category 22 (Accessibility & i18n)
Not reliability. Belongs in a UX or a11y audit. Removing it tightens the prompt's focus and the 23-category list becomes 22.

### Category 21 (Compliance & Data Governance)
Half-security, half-ops. Either split items into the Part 1 (Security) and Part 2 (Reliability) buckets or move to a dedicated compliance audit.

### Most of Category 23 (Operational Readiness)
You did keep the minimum needed line:
> "At minimum, every app needs: health check endpoint, enough logging to debug at 3am, error rate alerting."

Good. The rest of the bullets (on-call rotation, incident comms plan, SLO assessment) are team/process concerns, not code concerns. Either move to a "Team readiness" audit or drop.

### Line 235: "If README, CLAUDE.md, or architecture docs exist: spot-check key claims against code"
Good intent, wrong category. This is its own audit type ("doc drift"). When placed under Code Quality it gets token-starved. Consider making it a top-level instruction: "Before auditing, scan any README/CLAUDE.md/audit-report docs in the repo for claims of behavior; flag divergences as their own finding class."

---

## What v2 could add

### A post-audit self-check
Add at the end of the prompt:
> "Before returning your report, verify:
> 1. Every finding has an EVIDENCE quote.
> 2. At least one Issue Cluster is identified if finding count > 10.
> 3. The SKIPPED section names anything you did not deeply audit.
> 4. Fix Priority names a concrete first-three based on 'most likely real damage to users today.'
> 5. If any finding is tagged [inferred], the report's Fix Priority section tells the reader how to convert it to [verified] in under 10 minutes."

Self-check items that are easy to forget and cheap to enforce.

### A "Confidence Distribution" line in the summary
> "Of N total findings: X verified, Y inferred, Z conditional."

One line. Tells the reader how much of the report is grounded vs hypothesized. I'd expect >70% verified to be a good report.

### A "Findings that changed my mind" subsection
Optional but high-value when re-running after fixes:
> "Findings from prior pass that no longer apply (with evidence): …"
> "New findings introduced by prior fixes: …"

Closes the loop between audit and remediation.

### Explicit cost-tracking instruction for Category 24
Category 24 asks the right questions but doesn't ask the model to calculate a worst-case bill. Add:
> "For each metered API call, compute: worst-case monthly spend if an attacker held the trigger down. If answer is > $100/month for a hobby project or > $10K/month for a business, flag as CRITICAL regardless of other severity signals."

Concrete number turns "unbounded spend" into "you could owe OpenAI $40K tomorrow."

### A small list of anti-patterns known to fool LLM audits
Add to "AI Review Blind Spots":
- **Dead code that looks alive**: functions that are exported and well-commented but have no callers. Always `grep -rn` before trusting.
- **Fixes that don't touch the call site**: a function can be "fixed" while every caller still uses the old assumption.
- **Try/catches that look protective but swallow**: catches returning `null` that callers then treat as success.
- **Defaults that silently degrade**: `.find(...)?.value ?? '0'` defaulting to a value that means something different (midnight instead of "unknown").
- **Schema claims in comments**: "// UNIQUE constraint on X catches race" — grep the migration to verify, comments lie.

These are the categories I caught during the two-pass run. Naming them makes future runs find them faster.

---

## Ranked recommendations

If you accept only three changes:

1. **Require EVIDENCE quote as explicit output field.** Biggest quality lever. Currently implicit.
2. **Add prior-fix grep-verification instruction.** Would have made C1 and C2 findings unavoidable by rule, not by reflex.
3. **Replace the "list every file" opening with a risk-weighted-scan opening.** Frees models from the coverage-theater failure mode and permits deeper audits.

Everything else is polish.

---

## Measured impact between v1 and v2 runs on this codebase

| Dimension | v1 | v2 |
|---|---|---|
| Total findings | ~60 | 32 |
| % with source quotes | ~40% | ~95% |
| False positives in top-10 | 1 (admitted mid-analysis) | 0 |
| Regression-of-own-fix findings | 0 (v1 was first pass) | 3 (C2, C3, C4) |
| Clusters / root causes named | 0 | 5 |
| NOW vs FUTURE mix | unclassified | 20 NOW / 12 FUTURE |
| Fix-at-Scale items pulled out of priority list | 0 | 8 |
| Dead-code findings | 0 | 1 (rate limiter, most important finding in v2) |

v2 produced fewer findings, higher confidence, and the single most important finding of the entire engagement. That's the right trade-off.
