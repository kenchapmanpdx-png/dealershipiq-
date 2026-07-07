/**
 * Smoke test for Task 12 reference_facts — exercises the LIVE DB path of
 * src/lib/reference-facts.ts against real prod data (not grep, not mocks).
 *
 * Proves: brand-scoping join, latest-year selection, model-name matching, the
 * lineup-index fallback, and the fact_heavy / feature-flag gates all behave on
 * real rows. Uses TEST DEALERSHIP (not the public Demo Honda) and temporarily
 * flips vehicle_data_enabled ON, then RESTORES it to its original value.
 *
 * Run: npx tsx scripts/verify-reference-facts.ts
 *   (reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *
 * Does NOT call OpenAI — that is the eval harness (scripts/eval-grading.ts).
 */
/* eslint-disable no-console */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { serviceClient } from '@/lib/supabase/service';
import { getReferenceFactsForGrading } from '@/lib/reference-facts';

// Test Dealership (Honda) — safe to toggle; NOT the public Demo Honda.
const DEALERSHIP_ID = 'd0000000-0000-0000-0000-000000000001';

interface Probe {
  label: string;
  scenario: string;
  weightClass: string;
  expect: 'block' | 'null';
  mustInclude?: string[];
}

const PROBES: Probe[] = [
  {
    label: 'matched model — Accord',
    scenario: "Customer is looking at the 2026 Accord. What's the difference between the Sport and the EX-L?",
    weightClass: 'fact_heavy',
    expect: 'block',
    mustInclude: ['Accord', 'Sport', 'EX-L', 'hybrid'],
  },
  {
    label: 'matched model — CR-V (AWD pricing)',
    scenario: 'I like the CR-V but I want all-wheel drive. How much more does that cost?',
    weightClass: 'fact_heavy',
    expect: 'block',
    mustInclude: ['CR-V', 'AWD', 'LX'],
  },
  {
    label: 'no model named — lineup index fallback',
    scenario: "I'm thinking about going electric. What does Honda have?",
    weightClass: 'fact_heavy',
    expect: 'block',
    mustInclude: ['lineup', 'Prologue', 'EV'],
  },
  {
    label: 'gate — non-fact_heavy returns null',
    scenario: 'I love it, but my wife needs to see it first.',
    weightClass: 'rapport_heavy',
    expect: 'null',
  },
];

async function getFlag(): Promise<boolean | null> {
  const { data } = await serviceClient
    .from('feature_flags')
    .select('enabled')
    .eq('dealership_id', DEALERSHIP_ID)
    .eq('flag_name', 'vehicle_data_enabled')
    .maybeSingle();
  return data ? (data.enabled as boolean) : null;
}

async function setFlag(value: boolean): Promise<void> {
  await serviceClient
    .from('feature_flags')
    .upsert(
      { dealership_id: DEALERSHIP_ID, flag_name: 'vehicle_data_enabled', enabled: value },
      { onConflict: 'dealership_id,flag_name' }
    );
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase env (.env.local). Cannot run.');
    process.exit(2);
  }

  const original = await getFlag();
  console.log(`vehicle_data_enabled (before): ${original}`);
  await setFlag(true);

  let failed = 0;
  try {
    for (const p of PROBES) {
      const block = await getReferenceFactsForGrading(DEALERSHIP_ID, p.scenario, p.weightClass);
      const problems: string[] = [];

      if (p.expect === 'null' && block !== null) problems.push('expected null, got a block');
      if (p.expect === 'block') {
        if (!block) problems.push('expected a block, got null');
        else for (const kw of p.mustInclude ?? []) {
          if (!block.toLowerCase().includes(kw.toLowerCase())) problems.push(`missing "${kw}"`);
        }
      }

      const ok = problems.length === 0;
      if (!ok) failed++;
      console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${p.label}`);
      if (!ok) console.log(`  problems: ${problems.join('; ')}`);
      console.log(block ? indent(block) : '  (null)');
    }
  } finally {
    // Always restore the flag to its original state.
    if (original === null) {
      await serviceClient
        .from('feature_flags')
        .delete()
        .eq('dealership_id', DEALERSHIP_ID)
        .eq('flag_name', 'vehicle_data_enabled');
    } else {
      await setFlag(original);
    }
    console.log(`\nvehicle_data_enabled (restored): ${await getFlag()}`);
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

function indent(s: string): string {
  return s.split('\n').map((l) => `  | ${l}`).join('\n');
}

main().catch((err) => {
  console.error('verify-reference-facts failed:', err);
  process.exit(1);
});
