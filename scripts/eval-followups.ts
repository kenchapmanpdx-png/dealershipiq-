/**
 * Follow-up eval harness (F7 gold-set).
 *
 * Exercises the answer-conditional follow-up engine (generateFollowUp) that was
 * shipped but, per conversation-quality-plan-2026-07-03, had never actually run
 * under load (OpenAI quota was exhausted). For each gold scenario it generates:
 *   - Q2 after a STRONG answer  -> expect a brief ack + PIVOT to a new concern
 *   - Q2 after a WEAK answer     -> expect SAME topic, simpler angle, no pressure
 *   - Q3 (new concern not yet discussed)
 * and judges each with deterministic structural checks + an LLM-as-judge on the
 * conditional logic (topic changed vs held; never re-asks; never escalates).
 *
 * Run: OPENAI_API_KEY=... npx tsx scripts/eval-followups.ts
 * Exit: 0 pass-rate >= threshold · 1 below threshold · 2 engine unavailable.
 */
/* eslint-disable no-console */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { generateFollowUp, getOpenAICompletion } from '@/lib/openai';
import type { TranscriptEntry } from '@/lib/service-db';
import { GOLD_SET, type GoldCase } from './eval-gold-set';

const PASS_THRESHOLD = 0.8; // fraction of cases that must pass
const MAX_CHARS = 320; // 1-3 texting sentences
const MAX_SENTENCES = 3;

interface Case {
  label: string;
  quality: 'strong' | 'weak';
  step: 0 | 1; // 0 = Q2, 1 = Q3
  gold: GoldCase;
  history: TranscriptEntry[];
}

function ts() {
  return new Date().toISOString();
}

function buildCases(): Case[] {
  const cases: Case[] = [];
  for (const g of GOLD_SET) {
    const ans = { strong: g.strongAnswer, weak: g.weakAnswer } as const;
    for (const quality of ['strong', 'weak'] as const) {
      // Q2: after the opening scenario + the rep's first answer
      cases.push({
        label: `${g.scenarioId}-Q2-${quality}`,
        quality,
        step: 0,
        gold: g,
        history: [
          { direction: 'outbound', messageBody: g.scenario, createdAt: ts() },
          { direction: 'inbound', messageBody: ans[quality], createdAt: ts() },
        ],
      });
      // Q3: after a two-exchange history (canned prior Q2 + answer)
      cases.push({
        label: `${g.scenarioId}-Q3-${quality}`,
        quality,
        step: 1,
        gold: g,
        history: [
          { direction: 'outbound', messageBody: g.scenario, createdAt: ts() },
          { direction: 'inbound', messageBody: ans[quality], createdAt: ts() },
          { direction: 'outbound', messageBody: 'Okay. And how does the financing side usually work here?', createdAt: ts() },
          { direction: 'inbound', messageBody: 'We can walk through rates and terms and find a monthly payment that fits.', createdAt: ts() },
        ],
      });
    }
  }
  return cases;
}

function structuralProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text || text.trim().length === 0) problems.push('empty');
  if (text.length > MAX_CHARS) problems.push(`${text.length}>${MAX_CHARS} chars`);
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > MAX_SENTENCES) problems.push(`${sentences.length} sentences>${MAX_SENTENCES}`);
  return problems;
}

async function judge(c: Case, followUp: string): Promise<{ pass: boolean; reason: string }> {
  const convo = c.history
    .map((h) => `${h.direction === 'inbound' ? 'Salesperson' : 'Customer'}: ${h.messageBody}`)
    .join('\n');

  const expectation =
    c.quality === 'strong'
      ? 'Because the salesperson answered well, the new customer message SHOULD move on to a DIFFERENT concern (a pivot), optionally with a brief acknowledgment. It must NOT re-ask what was already answered.'
      : 'Because the salesperson answered weakly/vaguely, the new customer message SHOULD stay on the SAME topic with a simpler angle, WITHOUT increasing pressure. It must NOT summarize the correct answer back to them.';

  const prompt = `You are grading a single generated customer text message in a car-sales roleplay.

Conversation so far:
${convo}

Rule for this turn: ${expectation}
Universal rules: the message must sound like a real customer texting (1-3 short sentences), must NOT coach the salesperson, and must NOT repeat a question already answered.

Generated customer message:
"${followUp}"

Does the generated message satisfy the rule for this turn and the universal rules?
Answer with exactly one word on the first line: PASS or FAIL.
On the second line give a short reason (<= 15 words).`;

  const raw = await getOpenAICompletion(prompt, 'gpt-5.4', { max_tokens: 60 }, 'eval.followup.judge');
  const firstLine = raw.trim().split('\n')[0].toUpperCase();
  const pass = firstLine.includes('PASS') && !firstLine.includes('FAIL');
  const reason = raw.trim().split('\n').slice(1).join(' ').trim() || raw.trim();
  return { pass, reason };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set (put it in .env.local). Cannot run the follow-up eval.');
    process.exit(2);
  }

  const cases = buildCases();
  let passed = 0;
  let failed = 0;
  let unavailable = 0;
  const failures: string[] = [];

  console.log(`\nFollow-up eval — ${cases.length} cases (${GOLD_SET.length} scenarios x strong/weak x Q2/Q3)\n`);

  for (const c of cases) {
    let followUp: string;
    let model: string;
    try {
      const r = await generateFollowUp({
        scenario: c.gold.scenario,
        conversationHistory: c.history,
        mode: c.gold.mode,
        stepIndex: c.step,
        // no dealershipId -> skips the rate-limit / circuit-breaker gate
      });
      followUp = r.customerMessage;
      model = r.model;
    } catch (err) {
      unavailable++;
      failures.push(`${c.label}: generateFollowUp threw — ${(err as Error).message}`);
      continue;
    }

    if (model === 'circuit-open') {
      unavailable++;
      console.log(`${c.label.padEnd(16)}  circuit-open (engine unavailable)`);
      continue;
    }

    const problems = structuralProblems(followUp);
    let verdict: { pass: boolean; reason: string };
    if (problems.length) {
      verdict = { pass: false, reason: `structural: ${problems.join('; ')}` };
    } else {
      try {
        verdict = await judge(c, followUp);
      } catch (err) {
        verdict = { pass: false, reason: `judge error: ${(err as Error).message}` };
      }
    }

    if (verdict.pass) passed++;
    else {
      failed++;
      failures.push(`${c.label}: ${verdict.reason} | msg="${followUp.slice(0, 90)}"`);
    }
    console.log(`${c.label.padEnd(16)}  ${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.pass ? '' : verdict.reason}`);
  }

  const scored = passed + failed;
  const rate = scored > 0 ? passed / scored : 0;
  console.log(`\nPASS ${passed} · FAIL ${failed} · UNAVAILABLE ${unavailable}  (pass rate ${(rate * 100).toFixed(0)}%, threshold ${(PASS_THRESHOLD * 100).toFixed(0)}%)`);
  if (failures.length) {
    console.log('\nDetails:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  if (scored === 0) process.exit(2);
  process.exit(rate >= PASS_THRESHOLD ? 0 : 1);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
