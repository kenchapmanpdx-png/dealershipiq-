// Reference Facts — Ground-Truth Product Specs for fact_heavy GRADING.
//
// Task 12 (F1): fact_heavy grading must check product claims against a verified
// source, not the grader model's own knowledge. This module resolves the graded
// dealership's brands -> makes -> models/trims (loaded from CarAPI) and renders a
// compact, authoritative <reference_facts> block the grader scores against.
//
// Scope discipline (avoids blowing the prompt with 900+ trims):
//   1. Model named in the scenario  -> inject THAT model's latest-year trims.
//   2. No model named               -> inject a one-line-per-model lineup index
//                                       (price range + powertrains) for the brand.
//   3. Not fact_heavy / flag off / no brands / no data -> return null (no change).
//
// Feature flag: vehicle_data_enabled (per dealership) — same gate as scenario-gen
// vehicle data. Distinct from grader behavior so facts can be dark-launched.

import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled } from '@/lib/service-db';

const MAX_MODELS_MATCHED = 3; // cap trims injected when models are named
const MAX_LINEUP_MODELS = 20; // cap lines in the fallback lineup index
const MAX_TRIMS_PER_MODEL = 14; // guardrail against a pathological model-year

interface ModelRow {
  id: string;
  name: string;
  make_name: string;
}
interface TrimRow {
  name: string;
  msrp: number | null;
  hp: number | null;
  drivetrain: string | null;
  engine: string | null;
}

/**
 * Build the authoritative <reference_facts> block for a fact_heavy grade, or
 * null when it does not apply. Never throws — a data/DB problem degrades to
 * today's behavior (grade against elite_dialogue only) rather than blocking.
 */
export async function getReferenceFactsForGrading(
  dealershipId: string,
  scenarioText: string,
  weightClass?: string | null
): Promise<string | null> {
  if (weightClass !== 'fact_heavy') return null;

  try {
    const enabled = await isFeatureEnabled(dealershipId, 'vehicle_data_enabled');
    if (!enabled) return null;

    // dealership_brands -> make_ids (H-016 pattern: never leak other brands).
    const { data: brands } = await serviceClient
      .from('dealership_brands')
      .select('make_id')
      .eq('dealership_id', dealershipId);
    const makeIds = (brands ?? []).map((b) => b.make_id as string).filter(Boolean);
    if (makeIds.length === 0) return null;

    // Models for the dealership's makes (id, name, make name for the header).
    const { data: modelData } = await serviceClient
      .from('models')
      .select('id, name, makes!inner ( id, name )')
      .in('make_id', makeIds);
    const models: ModelRow[] = (modelData ?? []).map((m) => ({
      id: m.id as string,
      name: m.name as string,
      // Supabase types the embedded to-one `makes` as an array, but `!inner`
      // returns a single object at runtime. relName tolerates both.
      make_name: relName(m.makes),
    }));
    if (models.length === 0) return null;

    const matched = matchModels(scenarioText, models).slice(0, MAX_MODELS_MATCHED);

    const block = matched.length > 0
      ? await renderMatchedModels(matched)
      : await renderLineupIndex(models);

    if (!block) return null;

    return [
      '<reference_facts source="verified_vehicle_database">',
      'These are verified, authoritative specs for this dealership\'s brands. Use them to check the employee\'s product claims. If a stated price, horsepower, trim, drivetrain, or powertrain CONTRADICTS these facts, score product_accuracy 1-2. Specs NOT listed here (e.g. MPG, warranty terms, feature packages) are outside this reference -- judge them on general merit; do NOT penalize the employee for facts this reference does not cover.',
      block,
      '</reference_facts>',
    ].join('\n');
  } catch (err) {
    console.error('[reference-facts] fetch failed:', (err as Error).message ?? err);
    return null;
  }
}

// ─── Model-name detection ────────────────────────────────────────────────────

/**
 * Find models whose name appears in the scenario text. Word-boundary-ish match,
 * punctuation-insensitive so "CR-V", "CRV", and "cr v" all hit the "CR-V" model.
 * Longer names first so "CR-V Hybrid" wins over a bare "CR-V" when both exist.
 */
function matchModels(scenarioText: string, models: ModelRow[]): ModelRow[] {
  const hay = normalizeForMatch(scenarioText);
  const hits: ModelRow[] = [];
  const byLen = [...models].sort((a, b) => b.name.length - a.name.length);
  for (const m of byLen) {
    const needle = normalizeForMatch(m.name);
    if (!needle) continue;
    // Space-padded contains on normalized text = whole-token match.
    if (` ${hay} `.includes(` ${needle} `)) hits.push(m);
  }
  return hits;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // CR-V -> "cr v", e:FCEV -> "e fcev"
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Renderers ───────────────────────────────────────────────────────────────

async function renderMatchedModels(models: ModelRow[]): Promise<string | null> {
  const sections: string[] = [];
  for (const m of models) {
    // Latest model-year for this model, then its trims.
    const { data: my } = await serviceClient
      .from('model_years')
      .select('id, year')
      .eq('model_id', m.id)
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!my?.id) continue;

    const { data: trimData } = await serviceClient
      .from('trims')
      .select('name, msrp, hp, drivetrain, engine')
      .eq('model_year_id', my.id as string)
      .order('msrp', { ascending: true, nullsFirst: false })
      .limit(MAX_TRIMS_PER_MODEL);

    const trims: TrimRow[] = (trimData ?? []) as TrimRow[];
    if (trims.length === 0) continue;

    const lines = trims.map((t) => `- ${formatTrim(t)}`);
    sections.push(`${my.year as number} ${m.make_name} ${m.name}:\n${lines.join('\n')}`);
  }
  return sections.length > 0 ? sections.join('\n\n') : null;
}

async function renderLineupIndex(models: ModelRow[]): Promise<string | null> {
  const capped = models.slice(0, MAX_LINEUP_MODELS);
  const lines: string[] = [];
  let makeName = '';

  for (const m of capped) {
    makeName = makeName || m.make_name;
    // Latest year for the model, then aggregate its trims into a one-liner.
    const { data: my } = await serviceClient
      .from('model_years')
      .select('id, year')
      .eq('model_id', m.id)
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!my?.id) continue;

    const { data: trimData } = await serviceClient
      .from('trims')
      .select('msrp, engine')
      .eq('model_year_id', my.id as string);
    const trims = (trimData ?? []) as { msrp: number | null; engine: string | null }[];
    if (trims.length === 0) continue;

    const prices = trims.map((t) => t.msrp).filter((p): p is number => typeof p === 'number' && p > 0);
    const powertrains = Array.from(new Set(trims.map((t) => powertrain(t.engine)))).sort();
    const priceStr = prices.length
      ? prices.length === 1 || Math.min(...prices) === Math.max(...prices)
        ? `$${fmt(Math.min(...prices))}`
        : `$${fmt(Math.min(...prices))}-$${fmt(Math.max(...prices))}`
      : 'price N/A';
    lines.push(`- ${m.name}: ${priceStr} (${powertrains.join(', ')})`);
  }

  if (lines.length === 0) return null;
  const header = makeName ? `${makeName} lineup:` : 'Lineup:';
  return `${header}\n${lines.join('\n')}`;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatTrim(t: TrimRow): string {
  const parts: string[] = [t.name];
  const specs: string[] = [];
  if (typeof t.msrp === 'number' && t.msrp > 0) specs.push(`$${fmt(t.msrp)}`);
  if (typeof t.hp === 'number' && t.hp > 0) specs.push(`${t.hp} hp`);
  const dt = drivetrainAbbrev(t.drivetrain);
  if (dt) specs.push(dt);
  specs.push(powertrain(t.engine));
  return `${parts.join('')}: ${specs.join(', ')}`;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// Powertrain is carried in the engine label (e.g. "2.0L I4 hybrid",
// "electric (fuel cell)"), NOT in fuel_type (null from the CarAPI load).
function powertrain(engine: string | null): string {
  if (!engine) return 'gas';
  const e = engine.toLowerCase();
  if (e.includes('plug-in') || e.includes('phev')) return 'PHEV';
  if (e.includes('electric') || e.includes('ev')) return 'EV';
  if (e.includes('hybrid')) return 'hybrid';
  return 'gas';
}

// Read `.name` off a Supabase embedded relation that may be a single object
// (runtime, !inner to-one) or an array (how the client types it).
function relName(rel: unknown): string {
  const obj = Array.isArray(rel) ? rel[0] : rel;
  return ((obj as { name?: string } | null | undefined)?.name) ?? '';
}

function drivetrainAbbrev(driveType: string | null): string | null {
  if (!driveType) return null;
  const d = driveType.toLowerCase();
  if (d.includes('all wheel') || d === 'awd') return 'AWD';
  if (d.includes('front wheel') || d === 'fwd') return 'FWD';
  if (d.includes('rear wheel') || d === 'rwd') return 'RWD';
  if (d.includes('four wheel') || d.includes('4wd')) return '4WD';
  return null;
}
