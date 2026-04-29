# Feedback on Pressure Test A — Security & Attack Surface

Audience: the LLM/author maintaining this prompt.
Source of feedback: running Part A immediately after running Part B v2 on the same codebase, with the same sub-agent dispatch pattern, same source-quote discipline, same consolidation pass. I can directly compare A vs B quality and observe which parts of A under-performed.

Summary: **Part A is good but less sharp than Part B v2.** The security domain favors the LLM (lots of well-known patterns), but the prompt leaves several levers that B v2 adopted unpulled. Three changes would close the gap.

---

## What Part A got right (keep)

### Adversarial framing
"Penetration tester. Assume attackers are sophisticated, persistent, and have read your source code." Strong. Better than B's "hostile QA" because it names the adversary's capabilities explicitly.

### Immediate secrets scan up front
The "IMMEDIATE — before starting the category audit" block is excellent. Forces the easy-but-high-value check first (secrets in git, hardcoded keys). In my run this was a clean pass but the ritual still mattered — it framed the subsequent audit.

Keep.

### "Security theater check"
> "For every security control you find (auth check, rate limit, HMAC verification, input validation, CORS config), verify it actually enforces its stated purpose. … Flag these as HIGHER severity than missing controls — false confidence is worse than no confidence."

Single highest-leverage section of the prompt. It caught:
- S1 (rate limiter code exists, deps missing → dead code in prod)
- S9 (Stripe portal URL startsWith-validator → prefix bypass)
- S5 (open redirect "//`-check that misses `\\` and `%2F%2F`)

Without this framing, these would have been MEDIUM ("defense-in-depth gap") instead of CRITICAL / HIGH. The severity lift was correct and actionable.

Keep, and consider promoting it from prose to a required output column: `IS_SECURITY_THEATER: yes|no`.

### Platform-specific auth pitfalls
The Supabase / Firebase / Auth0 section with `getUser()` vs `getSession()`, RLS-under-service-role, etc. is excellent. It short-circuits an entire class of category-level framework mismatches.

Keep. Consider adding a few more common stacks (NextAuth, Clerk, AWS Cognito).

### Trust boundary tracing
> "For every piece of data that enters the system (user input, webhook payload, third-party API response, OAuth metadata), trace its path through storage to every display context. … Sanitization must happen at the boundary."

Worked. Caught S13 (scenario_bank prompt injection) and S8 (email template nested-placeholder expansion) which are cross-file trust-boundary crossings that LLMs miss in single-file reads.

Keep. Maybe add examples of common boundary crossings: "stored field → prompt", "webhook body → DB → dashboard", "user upload → filesystem → rendered".

### Confidence tags
Same leverage as in Part B. Forced me to grep-verify before stamping `[verified]`, honestly flag the `scenario_bank` RLS uncertainty as `[inferred]`, and mark TOCTOU-style concerns `[conditional]`.

Keep.

### Fix-at-Scale section
Worked. Kept 6 items out of the main tables (CI/CD hardening, SBOM/SLSA, SOC 2 prep) that would otherwise have made the priority list feel untriaged.

Keep.

### Issue Clusters
Caught Cluster B ("silent degradation when something is missing") which united four CRITICAL/HIGH findings under one fix. Without clusters, the reader sees four separate items; with clusters, they see "one boot-time env check resolves this class."

Keep — same verdict as Part B.

### "Skip what's irrelevant; document it"
The prompt allowed me to skip WebSocket, GraphQL, password hashing, YAML/XML, TLS cert audit — all legitimately N/A here. The SKIPPED section at the top of my report did real work.

Keep.

---

## What Part A should change

### 1. EVIDENCE is still implicit — make it required
Same complaint as for Part B v2. The output schema is a 7-column markdown table:

```
| # | File:Line | Category | Tag | Issue | Exploitation Scenario | Fix |
```

No column for the source quote. I switched to flat records with `EVIDENCE:` on each finding and the report reads much better for it. But the prompt itself doesn't mandate it, so less disciplined runs will skip quotes.

**Fix**: replace the table format with:

```
## FINDING <id> — <severity>
FILE: src/foo.ts:12-34
CATEGORY: <name>
TAG: [verified | inferred | conditional]
IS_SECURITY_THEATER: yes | no
EVIDENCE:
    <2-5 line quote from source>
SCENARIO: <concrete attack>
FIX:
    <code change>
```

Rationale: without the quote, there is no defensible claim. Four sub-agent findings in this run were confident hallucinations that would have slipped through without spot-verification.

### 2. Add a prior-fix verification instruction
This class of bug surfaced in my v2 pass on Part B and would have surfaced in A too if I hadn't been proactive:

- S1 — rate-limiter code references `@upstash/redis` which someone added to `package.json` but never ran `npm install`. Lockfile and node_modules empty. The fix from a prior audit pass is inert.

The prompt should institutionalize:
> **If prior audits or CHANGELOG entries exist, re-verify the fixes landed.** For every function, env var, or package the prior audit recommended, grep to confirm it's (a) present in the repo, (b) actually called from some code path, and (c) in the lockfile / deployed artifact. A fix that "was shipped" but isn't called or isn't installed is an active CRITICAL.

One sentence; huge leverage in a re-run context.

### 3. "List every file and directory" — same counterproductive phrasing as B
> "FIRST: List every file and directory in the project. Audit systematically — do not skip files you haven't looked at. Coverage gaps are audit failures."

In my run I inventoried 130 .ts/.tsx + 10 migrations and could only deeply audit a subset. The strict framing nudges models toward coverage theater. Replace with:

> "Map the attack surface by exploitability, not file count. Priority files: every webhook, every `/api/**` route, every middleware, every module under `/lib` that touches auth/crypto/secrets/network, and every migration that creates RLS policies. Skim everything else. Document what you skipped and why in a SKIPPED section at the top. Refusing to skim is undisciplined; skipping silently is the audit failure."

### 4. Severity rubric could be sharper for security
Current:

- 🔴 CRITICAL — Active exploitability, data breach, auth bypass, RCE
- 🟠 HIGH — Exploitable with effort, data exposure, privilege escalation

"Active exploitability" vs "exploitable with effort" is a fuzzy boundary that LLMs routinely get wrong in the pessimistic direction (over-marking CRITICAL).

Propose replacement:
- 🔴 CRITICAL — exploit is one HTTP request or a publicly known technique; can be executed by a script kiddie with your public URL
- 🟠 HIGH — exploit requires auth, chained primitives, or non-trivial crafting; within reach of a motivated attacker
- 🟡 MEDIUM — defense-in-depth gap; depends on another vuln to matter
- 🔵 LOW — hardening

Concrete rules for LLMs to self-check:
- If no auth needed AND exploit is a single request → CRITICAL
- If attacker needs insider access or a separate vuln to chain → downgrade to HIGH
- If "only" during a specific timing window (<1s) → add `[conditional]` tag and consider HIGH not CRITICAL

### 5. Category 2 ("Safe Failure Modes") lives in two worlds
It's half OWASP A10 (security), half reliability. In my Part B v2 run I caught "rate limiter fails open on DB error" as a reliability issue. Here it surfaced as the same finding with a security frame ("fails open = auth bypass").

**Suggestion**: keep it under Security but clarify the framing:
> "Safe failure modes in SECURITY paths. If the failure is in a reliability path (e.g., grading queue), flag briefly and defer to Part B. Focus this category on auth checks, permission checks, signature verification, and rate limiters."

### 6. Category 11 (AI/LLM) is strong on the prompt-injection surface but misses the underside
Current:
- Prompt injection (external content → LLM)
- LLM output validation
- Token usage monitoring

Missing:
- **Data flowing INTO the LLM**: PII minimization, retention (most LLM providers retain inputs for 30 days by default; is PII scrubbed before submission?)
- **Model availability as trust boundary**: if the primary model is deprecated/renamed (DealershipIQ hardcoded `gpt-5.4-2026-03-05` until last session), all LLM-dependent features silently degrade or fail. Not pure security but security-adjacent because fallback behavior has security implications.
- **LLM-as-parser**: when the LLM produces JSON that gets parsed and executed (e.g., tool calling), the LLM IS the attacker's entry point if inputs are user-controlled.

Add a sub-bullet:
> - **LLM as parser trust boundary**: Any LLM output that drives code paths (tool calls, JSON actions, SQL generation) must be schema-validated AND execution-sandboxed. The LLM is not a security control — treat its output as untrusted.

### 7. "Adapt to application type" could be more prescriptive
Currently:
> "Skip checks irrelevant to the stack but note what was skipped and why."

Models tend to interpret this broadly and under-skip. Add explicit stack profiles:
- **Serverless Next.js on Vercel**: skip thread contention, skip SSL cert rotation, skip proxy IP handling (Vercel handles). Focus on: env var exposure, middleware auth, function timeout → fail-open?, cold-start race conditions.
- **API-only**: skip CSP, skip clickjacking, skip UGC XSS. Focus on: OpenAPI/schema validation, rate limiting per key, CORS lockdown.
- **Mobile backend**: add certificate pinning audit, push notification trust model.

Cuts noise; focuses attention.

### 8. No instruction to check that security controls are **actually wired** end-to-end
This is the single biggest miss in v1-of-A. The rate-limiter (C1 from prior Reliability audit) was "fixed" by defining functions and wiring them in — but the dependencies were never installed. That's an end-to-end wiring gap.

The prompt has "SECURITY THEATER CHECK" which almost captures this, but it focuses on "does this control enforce its purpose" rather than "does this control actually run."

Add:
> **End-to-end wiring check**: For every security control you find, trace it through: defined → imported → called → behavior verifiable at runtime. A control defined but never called is the same as no control. A control called but whose dependencies aren't installed is worse than no control (creates false confidence in logs). Flag broken wiring as CRITICAL, even if the code looks correct in isolation.

### 9. Output-size budget
Like B v2, A doesn't specify a max finding count. My run returned 34 after dedupe. Still readable but 50+ would have been noise.

Add:
> "Target 20–35 findings total. Weighted toward CRITICAL / HIGH. Prefer one strong finding over three weak variants. Group variants into Issue Clusters."

### 10. The prompt never asks for proof-of-concept
The usage footer has "Pen test mode: Append `Write proof-of-concept exploit code for every 🔴 and 🟠 finding.`" — but that's opt-in.

For security audits specifically, a single-sentence PoC per CRITICAL would dramatically increase confidence:
> "For every 🔴 CRITICAL finding, include a one-line PoC curl command or a minimal exploitation step. If you can't write one, the finding might be theoretical; downgrade to HIGH."

Forces the LLM to prove the attack is actually executable.

### 11. The "Fix Priority" list doesn't account for deployment sequencing
My report's Fix Priority ordered by exploitability, but didn't account for deploy sequencing. E.g., fixing S1 (install Upstash deps) should happen BEFORE S3 (auth timing fix) because S3's fix relies on rate-limiting to matter — otherwise the brute-force defense stacks but is still bypassable.

Add:
> "In Fix Priority, note dependencies between fixes. 'Fix A before B because B relies on A to be effective.'"

---

## What Part A should remove

### Category 5 "Supply Chain Integrity" — split CI/CD concerns out explicitly
Currently the category mixes:
- Code-level (package.json, lockfile, versions) — auditable from source.
- CI/CD-level (SBOMs, SLSA, pipeline hardening) — not auditable from source.

My report used Fix-at-Scale to handle the CI/CD half. The prompt notes "flag as Fix at Scale if not verifiable from source" but models routinely ignore this and emit the whole list as regular findings.

**Fix**: make the split explicit. Give Category 5 ONLY the code-level items. Move CI/CD items to a dedicated "Pipeline & Build Security" section that routes directly to Fix-at-Scale unless the user has opted into pipeline audit.

### Category 10 "Privacy by Design" — partially overlaps with GDPR/compliance
Keep the items that are security-adjacent (PII in URLs, error messages, AI prompts). Move pure-retention / consent items (Art. 17 deletion, retention schedules) to a Compliance audit. Currently these create severity-inflation because "GDPR violation" feels CRITICAL but it's really a regulatory concern, not an exploit.

Middle ground: leave them here but cap severity at HIGH unless paired with a specific exploit (e.g., attacker uses unexpired retention to exfiltrate old data).

### Category 3 "Cookie flags" mini-list
Listing every cookie flag in prose is fine once, but "absolute timeout 2–8hrs, idle 15–30min" is overly prescriptive — the right timeout depends on the app (banking: 15min idle; B2B SaaS: 8hr absolute). Replace with:
> "Cookie flags: `Secure`, `HttpOnly`, `SameSite=Strict|Lax`. Timeouts appropriate to sensitivity."

### Repeated "What security controls are ABSENT?" at the end of every category
Keep it at the top of the prompt and once as a REMINDER mid-way (line 154 already does this). Repeating at every category adds tokens without adding signal.

---

## What Part A could add

### Post-audit self-check block
Mirror Part B v2:
> Before returning your report, verify:
> 1. Every finding has an EVIDENCE quote.
> 2. Every 🔴 CRITICAL has either a one-line PoC or an explicit `[theoretical_until_tested]` tag.
> 3. SKIPPED section names what you didn't audit and why.
> 4. At least one Issue Cluster is identified if finding count > 10.
> 5. Fix Priority's first three items name concrete exploit paths.
> 6. Any finding that claims "package X is not called" was verified with `grep -rn "X" src/`.
> 7. Any finding that claims "committed to git" was verified with `git ls-files`.

The last two would have prevented the four false positives my sub-agents produced.

### Confidence distribution summary
> "Of N findings: X [verified] (Y% of total), Z [inferred], W [conditional]."

One line. Tells the reader how much of the report is grounded.

### Dependency-on-dependency map for fixes
For any fix that requires a prior fix to be effective, state it. (See Change #11 above.)

### Standard PoC styles
Give the LLM a small PoC style guide:
- One-request exploits: `curl -X POST … -d '…'`
- Timing attacks: loop + timing assertion
- IDOR: two-account setup + swap
- Injection: payload string with expected vs. actual result

Makes PoCs consistent and comparable.

### "Compensating controls" section
Sometimes a finding is real but mitigated by something else. Add a column to findings:
> `COMPENSATED_BY: <other finding or control>` or `COMPENSATED_BY: none`

E.g., S3 (timing leak) is partially compensated by S6 (rate limiter) even though S6 is weak. Naming the compensation helps the reader decide priority.

### An explicit instruction to audit previous audit docs in the repo
The repo had multiple prior audit docs (`AUDIT-*.md`, `FULL-CODE-REVIEW-*.md`, `PRESSURE-TEST-B-*.md`). A useful instruction:
> "If previous audit reports exist in the repo (`AUDIT*.md`, `SECURITY*.md`, `REVIEW*.md`), scan them for findings claimed as fixed. For each, verify the fix actually landed. Report any that didn't."

This is the meta-form of "prior-fix verification" (#2 above).

---

## Quality comparison — A vs B v2 on this codebase

| Dimension | Part B v2 | Part A |
|---|---|---|
| Total findings (post-dedupe) | 32 | 34 |
| % with EVIDENCE quotes | ~95% | ~98% (better — security is more quote-ready) |
| False positives in top-10 | 0 | 0 (4 candidates dropped via spot-verify) |
| Issue Clusters named | 5 | 5 |
| Fix-at-Scale items split out | 8 | 6 |
| Time-to-draft (estimate) | ~12 min | ~9 min |
| Sharpest single finding | Rate-limiter has zero callers (B v2 C1) | Upstash deps missing from lockfile (A S1) |
| Security-theater findings | N/A (reliability) | 3 flagged explicitly |
| Findings blocked by sub-agent hallucination | 2 (flagged, dropped) | 4 (flagged, dropped) |

The LLM is better at security than at reliability on this stack — security has more well-known patterns and fewer business-logic dependencies. Consequently, Part A is slightly easier to make good, and the prompt has less room to add signal. But the items above (especially #1, #2, #8, and #10) would still move the needle.

---

## Ranked recommendations

If you accept only three changes:

1. **Replace the table-output with flat records that REQUIRE an `EVIDENCE:` field.** Same as B v2 feedback. Without this the quote requirement is optional and degrades under pressure.
2. **Add the "end-to-end wiring check" instruction.** This single sentence would have made S1 (Upstash deps missing) a by-rule finding rather than a by-luck finding.
3. **Add the prior-fix verification instruction.** In any re-audit context (which is most audits beyond the first), this prevents the class of bug where "the fix shipped but doesn't run."

Everything else is polish.

---

## Meta-observation

Running B v2 and A back-to-back on the same codebase produced a cleaner signal than running either alone. Many findings showed up in both — but with different framings:
- B v2 H17 (processDunning in wrong cron) vs A M6 (coach rate-limit fail-open): both are "degrades on failure" but one is reliability, the other security.
- B v2 H3 (challenges daily hardcoded model) vs A S13 (scenario_bank prompt injection): both are "external data flows into LLM" but one is availability, the other integrity.

Suggestion for the prompt author: **write a third prompt, Part C — Interaction Audit**, that explicitly asks the model to cross-reference Part A and Part B findings, looking for findings that are the same bug with different blast radii (security vs reliability). Alternatively, bake a section into both A and B called "Cross-reference":
> "If you're running this audit after/alongside its counterpart (A→B or B→A), briefly list any findings that match across both reports with different framings. Flag which framing is more actionable."

Would add 5 min to each run and produce surprisingly sharp consolidated priorities.
