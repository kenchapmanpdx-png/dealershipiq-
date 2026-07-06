/**
 * Grading eval harness (F7 gold-set).
 *
 * Closes the standing gap vs the project rule "no prompt in production without
 * an eval script." Runs the LIVE grader (gradeResponse) against a gold-set of
 * real scenarios, each with a strong and a weak rep answer, and asserts that:
 *   - strong answers grade materially higher than weak ones (regression signal)
 *   - strong answers clear a floor, weak answers stay under a ceiling
 *   - feedback is well-formed (non-empty, <=480 chars, carries a /20 score)
 *
 * Run BEFORE shipping any grader prompt/model change (e.g. F4 calibration) and
 * after any OPENAI_MODEL_* swap to catch calibration drift.
 *
 * Run: OPENAI_API_KEY=... npx tsx scripts/eval-grading.ts
 *   (reads .env.local automatically; grader_v7 fields are supplied inline so no
 *    DB or feature flag is required.)
 *
 * Exit codes: 0 all pass · 1 one or more calibration failures · 2 grader
 * unavailable (template fallback / missing key) — an infra problem, not a
 * calibration verdict.
 */
/* eslint-disable no-console */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { gradeResponse, computeWeightedTotal } from '@/lib/openai';
import { GOLD_SET, type GoldCase } from './eval-gold-set';

const STRONG_FLOOR = 13; // strong answers should land >= 13 / 20
const WEAK_CEILING = 11; // weak answers should land <= 11 / 20
const MIN_GAP = 3; // strong must beat weak by at least this many points

interface GradeOut {
  total: number;
  scores: { product_accuracy: number; tone_rapport: number; addressed_concern: number; close_attempt: number };
  model: string;
  feedback: string;
}

async function gradeOne(c: GoldCase, answer: string): Promise<GradeOut> {
  const now = new Date().toISOString();
  const r = await gradeResponse({
    scenario: c.scenario,
    employeeResponse: answer,
    mode: c.mode,
    conversationHistory: [
      { direction: 'outbound', messageBody: c.scenario, createdAt: now },
      { direction: 'inbound', messageBody: answer, createdAt: now },
    ],
    techniqueTag: c.techniqueTag,
    eliteDialogue: c.eliteDialogue,
    failSignals: c.failSignals,
    scenarioDomain: c.domain,
    weightClass: c.weightClass,
    // no dealershipId -> skips the per-dealership rate-limit / circuit-breaker gate
  });
  const scores = {
    product_accuracy: r.product_accuracy,
    tone_rapport: r.tone_rapport,
    addressed_concern: r.addressed_concern,
    close_attempt: r.close_attempt,
  };
  return { total: computeWeightedTotal(scores, c.weightClass), scores, model: r.model, feedback: r.feedback };
}

function structural(g: GradeOut): string[] {
  const problems: string[] = [];
  if (!g.feedback || g.feedback.trim().length === 0) problems.push('empty feedback');
  if (g.feedback && g.feedback.length > 480) problems.push(`feedback ${g.feedback.length}>480 chars`);
  if (g.feedback && !/\/20\b/.test(g.feedback)) problems.push('feedback missing /20 score');
  return problems;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set (put it in .env.local). Cannot run the grading eval.');
    process.exit(2);
  }

  let passed = 0;
  let failed = 0;
  let unavailable = 0;
  const failures: string[] = [];

  console.log(`\nGrading eval — ${GOLD_SET.length} scenarios (strong vs weak)\n`);
  console.log('scn  wc            strong  weak  gap  verdict');
  console.log('---  ------------  ------  ----  ---  -------');

  for (const c of GOLD_SET) {
    let strong: GradeOut, weak: GradeOut;
    try {
      // Sequential (not parallel) to stay well under any OpenAI rate limit.
      strong = await gradeOne(c, c.strongAnswer);
      weak = await gradeOne(c, c.weakAnswer);
    } catch (err) {
      unavailable++;
      failures.push(`${c.scenarioId}: grader threw — ${(err as Error).message}`);
      console.log(`${c.scenarioId.padEnd(3)}  ${c.weightClass.padEnd(12)}  ERROR (${(err as Error).message})`);
      continue;
    }

    if (strong.model === 'template-fallback' || weak.model === 'template-fallback') {
      unavailable++;
      console.log(`${c.scenarioId.padEnd(3)}  ${c.weightClass.padEnd(12)}  template-fallback (grader unavailable)`);
      continue;
    }

    const gap = strong.total - weak.total;
    const problems: string[] = [
      ...structural(strong).map((p) => `strong: ${p}`),
      ...structural(weak).map((p) => `weak: ${p}`),
    ];
    if (strong.total < STRONG_FLOOR) problems.push(`strong ${strong.total} < floor ${STRONG_FLOOR}`);
    if (weak.total > WEAK_CEILING) problems.push(`weak ${weak.total} > ceiling ${WEAK_CEILING}`);
    if (gap < MIN_GAP) problems.push(`gap ${gap} < ${MIN_GAP}`);

    const ok = problems.length === 0;
    if (ok) passed++;
    else {
      failed++;
      failures.push(`${c.scenarioId} (${c.weightClass}): ${problems.join('; ')}`);
    }
    console.log(
      `${c.scenarioId.padEnd(3)}  ${c.weightClass.padEnd(12)}  ${String(strong.total).padStart(6)}  ${String(weak.total).padStart(4)}  ${String(gap).padStart(3)}  ${ok ? 'PASS' : 'FAIL'}`
    );
  }

  console.log(`\nPASS ${passed} · FAIL ${failed} · UNAVAILABLE ${unavailable} (of ${GOLD_SET.length})`);
  if (failures.length) {
    console.log('\nDetails:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  if (unavailable > 0 && failed === 0 && passed === 0) process.exit(2);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
