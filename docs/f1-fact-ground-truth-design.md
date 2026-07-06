# F1 — Fact Ground-Truth for fact_heavy Grading (design)

Status: BLOCKED on data. Requirement confirmed 2026-07-07 (Ken). Not building hollow code — this doc is the build-ready spec.

## Requirement
- fact_heavy grading must check product facts against a verified source of truth, not the model's own knowledge.
- Source must be per-dealership, curated to the manufacturer brand(s) that dealership carries.
- "We're not quite there yet" — infra/data below do not exist; this is the future-build spec.

## Current state (verified 2026-07-07 against prod nnelylyialhnyytfeoom)
- 23 active `scenario_bank` rows are `weight_class='fact_heavy'`.
- fact_heavy grading (Template C + Template A fact_heavy) scores `product_accuracy` against the scenario's `elite_dialogue` / `technique_tag` reference — generic, NOT brand/model-specific.
- `dealership_brands` table EXISTS; brand selection at onboarding is DONE (`/api/onboarding/brands`, `make_id` resolution).
- Vehicle tables DO exist in prod (Phase 4B: makes, models, model_years, trims, trim_features, selling_points, competitive_sets). Row counts: makes 4 (Honda/Toyota/Hyundai/Kia), models 10, model_years 19, trims 124. **trim_features 0, selling_points 0, competitive_sets 0 (all empty).**
- Source of the trim data = **fueleconomy.gov** (free EPA open data / API — no signup or API key). `scripts/seed-vehicle-data.py` seeds it from a fueleconomy.gov CSV. `src/lib/vehicle-data.ts` reads these tables (DB-only, feature-flag `vehicle_data_enabled`, default OFF). No commercial vehicle-facts API/provider is integrated anywhere (no provider name, no key in .env.example, no memory record).
- Eval harness (`scripts/eval-grading.ts`) already gives basic fact-regression coverage on scenarios 056/057/059 (strong=correct vs weak=wrong must diverge). It does NOT yet assert against a curated fact key.

## Blockers (must resolve before build)
1. Fact SOURCE decision (the gating one): fueleconomy.gov specs cover MPG / fuel type / drivetrain / transmission / body class / displacement — enough for some fact_heavy scenarios (e.g. AWD vs 4WD, MPG positioning) but NOT safety-tech differentiators, warranty terms, or feature-level marketing facts. Those need either manual curation, a commercial vehicle-facts API (none currently signed up / wired), or restricting fact_heavy scenarios to spec-checkable topics.
2. Derived intel tables (trim_features / selling_points / competitive_sets) are empty — `scripts/generate-competitive-intel.py` (OpenAI-generated) was never run against current prod.
3. fueleconomy.gov coverage is partial vs intended (10 models / 124 trims now, vs 60 models / 337 trims targeted in the original Phase 4B seed).

## Proposed design
### Schema (new)
`brand_facts` — one row per (make, fact), curated:
- `make_id` FK -> `makes`
- `category` (e.g. drivetrain, safety, fuel_economy, warranty, towing)
- `claim` (the canonical true statement, plain text)
- `source` (where the fact came from; audit trail)
- `is_active`, `created_at`, `updated_at`

Optionally `scenario_fact_map` linking `scenario_bank.scenario_id` -> the `brand_facts` rows that scenario tests.

### Grading integration
- For a fact_heavy grade, resolve the graded user's `dealership_brands` -> `make_id`s -> relevant `brand_facts`.
- Inject those verified facts into the grader prompt as an authoritative `<reference_facts>` block; instruct: score `product_accuracy` against these facts, not prior knowledge; a claim contradicting a reference fact = 1-2.
- Fall back to today's `elite_dialogue` reference when no brand facts exist (no regression).

### Eval integration
- Extend the gold-set with a `factKey` for fact_heavy cases (the specific facts the answer must contain / must not contradict).
- `eval-grading.ts` asserts the grader penalizes fact violations and credits correct facts — the release-blocker check before compensation.

## Phased plan
1. Decide fact source-of-truth + ownership (Ken).
2. Create `brand_facts` table (vehicle tables already exist in prod; reuse `makes`/`trims` where specs suffice).
3. Curate facts for the launch dealership's brand(s) only (start narrow).
4. Wire `<reference_facts>` into fact_heavy grading behind a feature flag.
5. Add `factKey` to eval gold-set; gate on eval before enabling the flag.

## Dependencies
- `dealership_brands` (exists), `makes` (exists), eval harness (exists), feature-flag system (exists).
- Curated fact data (missing — the gating dependency).
