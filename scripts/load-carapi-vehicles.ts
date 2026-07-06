/**
 * Load vehicle spec data from CarAPI (carapi.app) into the vehicle tables
 * (makes -> models -> model_years -> trims). Go-forward source of truth for
 * vehicle facts (supersedes the earlier fueleconomy.gov seed).
 *
 * SAFETY: dry-run by DEFAULT. Fetches + transforms + prints what it WOULD write;
 * only touches the database when you pass --commit. Run once without --commit
 * and read the summary first.
 *
 * Run:
 *   npx tsx scripts/load-carapi-vehicles.ts                 # dry run, all 4 makes
 *   npx tsx scripts/load-carapi-vehicles.ts Toyota Hyundai  # dry run, subset
 *   npx tsx scripts/load-carapi-vehicles.ts Toyota --commit # write Toyota to DB
 *
 * Env (.env.local — never commit real values; the GitHub repo is public):
 *   CARAPI_API_TOKEN, CARAPI_API_SECRET
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   CARAPI_YEARS (optional, default "2025,2026")
 *
 * Endpoints: v2 ONLY — /api/trims/v2, /api/engines/v2.
 * Quirks handled:
 *   - MSRP no-clobber: never overwrite an existing non-zero msrp with 0/null
 *     (CarAPI returns $0 for some trims, e.g. 2026 Accord — manually backfilled).
 *   - Trim-name dedupe: (model_year_id, name) is UNIQUE but CarAPI repeats trim
 *     names across drivetrains/body styles; names are disambiguated by appending
 *     drivetrain (then body) only when a base name collides.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const CARAPI_BASE = 'https://carapi.app';
const API_TOKEN = process.env.CARAPI_API_TOKEN ?? '';
const API_SECRET = process.env.CARAPI_API_SECRET ?? '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const COMMIT = process.argv.includes('--commit');
const YEARS = (process.env.CARAPI_YEARS ?? '2025,2026')
  .split(',')
  .map((y) => parseInt(y.trim(), 10))
  .filter((y) => !Number.isNaN(y));
const DEFAULT_MAKES = ['Honda', 'Toyota', 'Hyundai', 'Kia'];
const TARGET_MAKES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MAKES = TARGET_MAKES.length ? TARGET_MAKES : DEFAULT_MAKES;

if (!API_TOKEN || !API_SECRET) {
  console.error('Missing CARAPI_API_TOKEN / CARAPI_API_SECRET (.env.local).');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface CarApiTrim {
  id: number; make: string; model: string; year: number; trim: string;
  submodel: string | null; description: string | null; msrp: number | null; invoice: number | null;
}
interface CarApiEngine {
  trim_id: number; engine_type: string | null; fuel_type: string | null; cylinders: string | null;
  size: string | null; horsepower_hp: number | null; torque_ft_lbs: number | null;
  drive_type: string | null; transmission: string | null;
}

async function login(): Promise<string> {
  const res = await fetch(`${CARAPI_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'text/plain' },
    body: JSON.stringify({ api_token: API_TOKEN, api_secret: API_SECRET }),
  });
  if (!res.ok) throw new Error(`CarAPI auth failed: ${res.status} ${await res.text()}`);
  const raw = (await res.text()).trim();
  // CarAPI returns the JWT as plain text; tolerate a JSON-wrapped token too.
  let jwt = raw.replace(/^"|"$/g, '');
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      jwt = obj.jwt ?? obj.token ?? obj.access_token ?? jwt;
    } catch { /* fall back to raw */ }
  }
  if (!jwt || jwt.split('.').length !== 3) {
    throw new Error(`CarAPI auth returned an unexpected token: ${raw.slice(0, 80)}`);
  }
  return jwt;
}

async function fetchAllPages<T>(endpoint: string, jwt: string): Promise<T[]> {
  const filter = JSON.stringify([
    { field: 'make', op: 'in', val: MAKES },
    { field: 'year', op: 'in', val: YEARS },
  ]);
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const url = `${CARAPI_BASE}/api/${endpoint}?limit=1000&page=${page}&json=${encodeURIComponent(filter)}`;
    const res = await fetch(url, { headers: { accept: 'application/json', Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`CarAPI ${endpoint} page ${page} failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { collection?: { next?: string }; data?: T[] };
    out.push(...(body.data ?? []));
    if (!body.collection?.next) break;
    page += 1;
  }
  return out;
}

function drivetrainAbbrev(driveType: string | null): string | null {
  if (!driveType) return null;
  const d = driveType.toLowerCase();
  if (d.includes('all wheel')) return 'AWD';
  if (d.includes('front wheel')) return 'FWD';
  if (d.includes('rear wheel')) return 'RWD';
  if (d.includes('four wheel') || d.includes('4wd')) return '4WD';
  return null;
}

// Leading body token from a CarAPI description, e.g. "4dr SUV AWD (...)" -> "4dr SUV"
function bodyFromDescription(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/^([0-9]?dr\s+[A-Za-z-]+)/);
  return m ? m[1].trim() : null;
}

function engineLabel(e?: CarApiEngine): string | null {
  if (!e) return null;
  const parts = [e.size ? `${e.size}L` : null, e.cylinders, e.engine_type].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

interface TrimRow {
  name: string; msrp: number | null; invoice: number | null; engine: string | null;
  hp: number | null; torque: number | null; transmission: string | null;
  drivetrain: string | null; fuel_type: string | null;
}
interface ModelBucket { make: string; model: string; body_style: string | null; years: Map<number, TrimRow[]>; }

function build(trims: CarApiTrim[], engines: CarApiEngine[]): Map<string, ModelBucket> {
  const engineByTrim = new Map<number, CarApiEngine>();
  for (const e of engines) if (!engineByTrim.has(e.trim_id)) engineByTrim.set(e.trim_id, e);

  const models = new Map<string, ModelBucket>();
  // Defensive: only keep requested makes/years even if the API filter over-returns.
  const makesLc = new Set(MAKES.map((m) => m.toLowerCase()));
  const yearsSet = new Set(YEARS);
  interface Candidate extends TrimRow { baseName: string; make: string; model: string; year: number; body: string | null; }
  const candidates: Candidate[] = [];
  for (const t of trims) {
    if (!makesLc.has((t.make ?? '').toLowerCase()) || !yearsSet.has(t.year)) continue;
    const e = engineByTrim.get(t.id);
    const baseName = (t.trim || t.submodel || 'Base').trim();
    candidates.push({
      baseName, name: baseName, make: t.make, model: t.model, year: t.year,
      msrp: t.msrp ?? null, invoice: t.invoice ?? null, engine: engineLabel(e),
      hp: e?.horsepower_hp ?? null, torque: e?.torque_ft_lbs ?? null,
      transmission: e?.transmission ?? null, drivetrain: drivetrainAbbrev(e?.drive_type ?? null),
      fuel_type: e?.fuel_type ?? null, body: bodyFromDescription(t.description),
    });
  }

  // Disambiguate trim names within (make, model, year, baseName) groups.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const k = `${c.make}|${c.model}|${c.year}|${c.baseName}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }
  for (const grp of Array.from(groups.values())) {
    if (grp.length === 1) continue;
    for (const c of grp) {
      const suffix = [c.drivetrain, c.body].filter(Boolean).join(' ');
      if (suffix) c.name = `${c.baseName} ${suffix}`.trim();
    }
    // If suffixes still collide, append an index for uniqueness.
    const seen = new Map<string, number>();
    for (const c of grp) {
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      if (n > 1) c.name = `${c.name} #${n}`;
    }
  }

  for (const c of candidates) {
    const mk = `${c.make}|${c.model}`;
    let bucket = models.get(mk);
    if (!bucket) {
      bucket = { make: c.make, model: c.model, body_style: c.body, years: new Map() };
      models.set(mk, bucket);
    }
    const arr = bucket.years.get(c.year) ?? bucket.years.set(c.year, []).get(c.year)!;
    arr.push({
      name: c.name, msrp: c.msrp, invoice: c.invoice, engine: c.engine, hp: c.hp,
      torque: c.torque, transmission: c.transmission, drivetrain: c.drivetrain, fuel_type: c.fuel_type,
    });
  }
  return models;
}

async function getOrCreateMake(name: string): Promise<string> {
  const { data } = await supabase.from('makes').select('id').eq('name', name).limit(1).maybeSingle();
  if (data?.id) return data.id as string;
  const { data: ins, error } = await supabase.from('makes').insert({ name }).select('id').single();
  if (error) throw error;
  return ins!.id as string;
}
async function getOrCreateModel(makeId: string, name: string, bodyStyle: string | null): Promise<string> {
  const { data } = await supabase.from('models').select('id').eq('make_id', makeId).eq('name', name).limit(1).maybeSingle();
  if (data?.id) return data.id as string;
  const { data: ins, error } = await supabase.from('models').insert({ make_id: makeId, name, body_style: bodyStyle }).select('id').single();
  if (error) throw error;
  return ins!.id as string;
}
async function getOrCreateModelYear(modelId: string, year: number): Promise<string> {
  const { data } = await supabase.from('model_years').select('id').eq('model_id', modelId).eq('year', year).limit(1).maybeSingle();
  if (data?.id) return data.id as string;
  const { data: ins, error } = await supabase.from('model_years').insert({ model_id: modelId, year }).select('id').single();
  if (error) throw error;
  return ins!.id as string;
}

async function upsertTrim(modelYearId: string, row: TrimRow) {
  const { data: existing } = await supabase
    .from('trims').select('id, msrp')
    .eq('model_year_id', modelYearId).eq('name', row.name).limit(1).maybeSingle();

  // MSRP no-clobber: keep an existing non-zero msrp if the incoming one is 0/null.
  let msrp = row.msrp;
  const existingMsrp = existing?.msrp as number | null | undefined;
  if ((!msrp || msrp === 0) && existingMsrp && existingMsrp > 0) msrp = existingMsrp;

  const payload = {
    model_year_id: modelYearId, name: row.name, msrp, invoice: row.invoice, engine: row.engine,
    hp: row.hp, torque: row.torque, transmission: row.transmission, drivetrain: row.drivetrain, fuel_type: row.fuel_type,
  };

  if (existing?.id) {
    const { error } = await supabase.from('trims').update(payload).eq('id', existing.id);
    if (error) throw error;
    return 'updated';
  }
  const { error } = await supabase.from('trims').insert(payload);
  if (error) throw error;
  return 'inserted';
}

async function main() {
  console.log(`CarAPI load — makes: ${MAKES.join(', ')} · years: ${YEARS.join(', ')} · mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
  const jwt = await login();
  console.log('Authenticated with CarAPI.');

  const [trims, engines] = await Promise.all([
    fetchAllPages<CarApiTrim>('trims/v2', jwt),
    fetchAllPages<CarApiEngine>('engines/v2', jwt),
  ]);
  console.log(`Fetched ${trims.length} trims, ${engines.length} engines.`);

  const models = build(trims, engines);
  let trimCount = 0;
  for (const b of Array.from(models.values())) {
    for (const arr of Array.from(b.years.values())) trimCount += arr.length;
  }
  console.log(`Assembled ${models.size} models, ${trimCount} trims across ${YEARS.length} year(s).`);

  if (!COMMIT) {
    console.log('\n--- DRY RUN preview (first 3 models) ---');
    let shown = 0;
    for (const b of Array.from(models.values())) {
      if (shown++ >= 3) break;
      console.log(`\n${b.make} ${b.model} (${b.body_style ?? 'body ?'})`);
      for (const [yr, arr] of Array.from(b.years.entries())) {
        console.log(`  ${yr}: ${arr.map((t) => `${t.name} [$${t.msrp ?? '-'}, ${t.hp ?? '-'}hp, ${t.drivetrain ?? '-'}]`).join('; ')}`);
      }
    }
    console.log('\nDRY RUN — nothing written. Re-run with --commit to write to the database.');
    return;
  }

  let inserted = 0;
  let updated = 0;
  for (const b of Array.from(models.values())) {
    const makeId = await getOrCreateMake(b.make);
    const modelId = await getOrCreateModel(makeId, b.model, b.body_style);
    for (const [yr, arr] of Array.from(b.years.entries())) {
      const myId = await getOrCreateModelYear(modelId, yr);
      for (const row of arr) {
        const res = await upsertTrim(myId, row);
        if (res === 'inserted') inserted += 1;
        else updated += 1;
      }
    }
  }
  console.log(`\nDone. Trims inserted: ${inserted}, updated: ${updated}.`);
}

main().catch((err) => {
  console.error('Load failed:', err);
  process.exit(1);
});
