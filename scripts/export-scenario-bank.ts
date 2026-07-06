/**
 * Export script: scenario_bank (production) -> docs/scenario-bank-v2-import.csv
 *
 * Why this exists (2026-07-05 AUDIT — bank drift):
 *   Production scenario_bank held 265 rows while the repo's canonical CSV held
 *   only 217 — a silent source-of-truth drift. Anyone re-seeding or auditing
 *   from the repo file would lose 48 live scenarios. This script regenerates
 *   the canonical CSV directly from prod so the repo always mirrors reality.
 *   Re-run it any time the bank changes; it is the durable fix for the drift.
 *
 * Run: npx tsx scripts/export-scenario-bank.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env (or .env.local)
 *
 * Columns: the original 8-column header plus weight_class + is_active, which
 * the old CSV lacked but which drive grading (weight_class) and scenario
 * selection (is_active). elite_response is intentionally omitted (0 populated
 * rows in prod; elite_dialogue is the live field).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const COLUMNS = [
  'scenario_id',
  'customer_line',
  'technique_tag',
  'elite_dialogue',
  'fail_signals',
  'mode',
  'domain',
  'difficulty',
  'weight_class',
  'is_active',
] as const;

// RFC4180 quoting: wrap every field in double quotes and double any internal
// quotes. Nulls render as empty. Consistent quoting keeps the file diff-stable.
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

async function main() {
  const { data, error } = await supabase
    .from('scenario_bank')
    .select(COLUMNS.join(','))
    .order('scenario_id', { ascending: true });

  if (error) {
    console.error('Export query failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvCell(row[c])).join(','));
  }

  const outPath = path.resolve(__dirname, '../docs/scenario-bank-v2-import.csv');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');

  const active = rows.filter((r) => r.is_active === true).length;
  console.log(`Exported ${rows.length} scenarios (${active} active) -> ${outPath}`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
