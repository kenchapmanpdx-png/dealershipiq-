// Vehicle Data — Prompt Integration for Training Scenarios
// Fetches vehicle specs, competitive sets, and selling points for prompt injection.
// Feature flag: vehicle_data_enabled (per dealership)

import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled } from '@/lib/service-db';
import type { TrimWithContext, VehicleContext, SellingPoint, CompetitiveSet } from '@/types/vehicle';

/**
 * Get vehicle context for a training scenario.
 * Returns null if vehicle_data_enabled is false or no vehicle data available.
 */
export async function getVehicleContextForScenario(
  dealershipId: string,
  domain: string
): Promise<VehicleContext | null> {
  const enabled = await isFeatureEnabled(dealershipId, 'vehicle_data_enabled');
  if (!enabled) return null;

  try {
    // Get dealership brands (which makes they sell)
    const { data: brands } = await serviceClient
      .from('dealership_brands')
      .select('make_id')
      .eq('dealership_id', dealershipId);

    const makeIds = (brands ?? []).map((b) => b.make_id as string);

    // Get a random trim from dealership's brands (current year preferred)
    const primary = await getRandomTrim(makeIds.length > 0 ? makeIds : null);
    if (!primary) return null;

    // For competitive_positioning or product_knowledge, also get competitor
    let competitor: TrimWithContext | null = null;
    let competitiveNotes: CompetitiveSet | null = null;

    if (domain === 'competitive_positioning' || domain === 'product_knowledge') {
      const compData = await getCompetitorForTrim(primary.id);
      if (compData) {
        competitor = compData.competitor;
        competitiveNotes = compData.notes;
      }
    }

    // Get selling points for primary vehicle
    const sellingPoints = await getSellingPointsForTrim(primary.id);

    return { primary, competitor, sellingPoints, competitiveNotes };
  } catch (err) {
    console.error('Vehicle context fetch failed:', err);
    return null;
  }
}

/**
 * Format vehicle context into compact prompt text for injection.
 * Handles NULL fields gracefully — omits rather than fabricates.
 */
export function formatVehiclePrompt(ctx: VehicleContext): string {
  if (!ctx.primary) return '';

  const p = ctx.primary;
  const lines: string[] = [];

  lines.push('VEHICLE DATA (use ONLY these specs, never your training knowledge for specific numbers):');

  // Primary vehicle
  const primarySpecs: string[] = [];
  if (p.drivetrain) primarySpecs.push(p.drivetrain);
  if (p.engine) primarySpecs.push(p.engine);
  if (p.fuel_type && p.fuel_type !== 'gasoline') primarySpecs.push(p.fuel_type);

  lines.push(`Primary: ${p.model_year.year} ${p.make.name} ${p.model.name} ${p.name} | ${primarySpecs.join(' | ')}`);

  // MPG line
  const mpgParts: string[] = [];
  if (p.mpg_city != null) mpgParts.push(`${p.mpg_city} city`);
  if (p.mpg_highway != null) mpgParts.push(`${p.mpg_highway} hwy`);
  if (p.mpg_combined != null) mpgParts.push(`${p.mpg_combined} combined`);
  if (mpgParts.length > 0) {
    let mpgLine = `  MPG: ${mpgParts.join(' / ')}`;
    if (p.annual_fuel_cost != null) mpgLine += ` | Annual fuel: $${p.annual_fuel_cost.toLocaleString()}`;
    lines.push(mpgLine);
  }

  // MSRP if available
  if (p.msrp != null) {
    lines.push(`  MSRP: $${p.msrp.toLocaleString()}`);
  }

  // HP/torque if available
  const perfParts: string[] = [];
  if (p.hp != null) perfParts.push(`${p.hp} hp`);
  if (p.torque != null) perfParts.push(`${p.torque} lb-ft`);
  if (perfParts.length > 0) lines.push(`  Performance: ${perfParts.join(' / ')}`);

  // Competitor vehicle
  if (ctx.competitor) {
    const c = ctx.competitor;
    lines.push('');
    const compSpecs: string[] = [];
    if (c.drivetrain) compSpecs.push(c.drivetrain);
    if (c.engine) compSpecs.push(c.engine);

    lines.push(`Competitor: ${c.model_year.year} ${c.make.name} ${c.model.name} ${c.name} | ${compSpecs.join(' | ')}`);

    const cmpgParts: string[] = [];
    if (c.mpg_city != null) cmpgParts.push(`${c.mpg_city} city`);
    if (c.mpg_highway != null) cmpgParts.push(`${c.mpg_highway} hwy`);
    if (c.mpg_combined != null) cmpgParts.push(`${c.mpg_combined} combined`);
    if (cmpgParts.length > 0) {
      let cmpgLine = `  MPG: ${cmpgParts.join(' / ')}`;
      if (c.annual_fuel_cost != null) cmpgLine += ` | Annual fuel: $${c.annual_fuel_cost.toLocaleString()}`;
      lines.push(cmpgLine);
    }
    if (c.msrp != null) lines.push(`  MSRP: $${c.msrp.toLocaleString()}`);
  }

  // Selling points
  if (ctx.sellingPoints.length > 0) {
    lines.push('');
    lines.push('KEY SELLING POINTS:');
    for (const sp of ctx.sellingPoints.slice(0, 5)) {
      let spLine = `- ${sp.advantage}`;
      if (sp.vs_competitor) spLine += ` (vs: ${sp.vs_competitor})`;
      lines.push(spLine);
      if (sp.objection_response) {
        lines.push(`  [Objection response]: "${sp.objection_response}"`);
      }
    }
  }

  // Competitive notes
  if (ctx.competitiveNotes) {
    const cn = ctx.competitiveNotes.comparison_notes;
    if (cn.key_differentiators && cn.key_differentiators.length > 0) {
      lines.push('');
      lines.push('KEY DIFFERENTIATORS:');
      for (const d of cn.key_differentiators.slice(0, 3)) {
        lines.push(`- ${d}`);
      }
    }
  }

  lines.push('');
  lines.push('IMPORTANT: If a spec is not listed above, do NOT mention it in the scenario. Only use provided data.');

  return lines.join('\n');
}

// ─── Internal helpers ────────────────────────────────────────────────

async function getRandomTrim(makeIds: string[] | null): Promise<TrimWithContext | null> {
  // Build query: get trims with full context (model_year → model → make)
  let query = serviceClient
    .from('trims')
    .select(`
      *,
      model_years!inner (
        id, year, is_current,
        models!inner (
          id, name, body_style, segment,
          makes!inner ( id, name, country )
        )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  // If makeIds provided, filter. Otherwise get any.
  // Note: We can't directly filter by make_id through nested joins easily,
  // so we'll filter in JS after fetching.

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  // Filter by makeIds if provided
  let filtered = data;
  if (makeIds && makeIds.length > 0) {
    filtered = data.filter((t) => {
      const my = t.model_years as Record<string, unknown>;
      const model = my.models as Record<string, unknown>;
      const make = model.makes as Record<string, unknown>;
      return makeIds.includes(make.id as string);
    });
    if (filtered.length === 0) filtered = data; // fallback to any
  }

  // Prefer current year trims
  const currentYear = new Date().getFullYear();
  const currentYearTrims = filtered.filter((t) => {
    const my = t.model_years as Record<string, unknown>;
    return (my.year as number) >= currentYear;
  });

  const pool = currentYearTrims.length > 0 ? currentYearTrims : filtered;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  return mapTrimRow(pick);
}

async function getCompetitorForTrim(trimId: string): Promise<{
  competitor: TrimWithContext;
  notes: CompetitiveSet;
} | null> {
  // Check competitive_sets where this trim is vehicle_a or vehicle_b
  const { data, error } = await serviceClient
    .from('competitive_sets')
    .select(`
      id, vehicle_a_trim_id, vehicle_b_trim_id, comparison_notes, generated_by, reviewed_at,
      trim_a:trims!vehicle_a_trim_id (
        *, model_years!inner ( id, year, is_current, models!inner ( id, name, body_style, segment, makes!inner ( id, name, country ) ) )
      ),
      trim_b:trims!vehicle_b_trim_id (
        *, model_years!inner ( id, year, is_current, models!inner ( id, name, body_style, segment, makes!inner ( id, name, country ) ) )
      )
    `)
    .or(`vehicle_a_trim_id.eq.${trimId},vehicle_b_trim_id.eq.${trimId}`)
    .limit(10);

  if (error || !data || data.length === 0) return null;

  // Pick a random competitive set
  const pick = data[Math.floor(Math.random() * data.length)];

  // Determine which side is the competitor
  const isA = (pick.vehicle_a_trim_id as string) === trimId;
  const competitorRow = isA ? (pick.trim_b as unknown as Record<string, unknown>) : (pick.trim_a as unknown as Record<string, unknown>);

  if (!competitorRow) return null;

  const notes: CompetitiveSet = {
    id: pick.id as string,
    vehicle_a_trim_id: pick.vehicle_a_trim_id as string,
    vehicle_b_trim_id: pick.vehicle_b_trim_id as string,
    comparison_notes: (pick.comparison_notes as CompetitiveSet['comparison_notes']) ?? {
      advantages_a: [],
      advantages_b: [],
      key_differentiators: [],
    },
    generated_by: (pick.generated_by as CompetitiveSet['generated_by']) ?? 'llm',
    reviewed_at: pick.reviewed_at as string | null,
  };

  return {
    competitor: mapTrimRow(competitorRow),
    notes,
  };
}

async function getSellingPointsForTrim(trimId: string): Promise<SellingPoint[]> {
  const { data, error } = await serviceClient
    .from('selling_points')
    .select('id, trim_id, advantage, vs_competitor, objection_response, category, generated_by, reviewed_at')
    .eq('trim_id', trimId);

  if (error || !data) return [];

  return data.map((sp) => ({
    id: sp.id as string,
    trim_id: sp.trim_id as string,
    advantage: sp.advantage as string,
    vs_competitor: sp.vs_competitor as string | null,
    objection_response: sp.objection_response as string | null,
    category: sp.category as string | null,
    generated_by: (sp.generated_by as SellingPoint['generated_by']) ?? 'llm',
    reviewed_at: sp.reviewed_at as string | null,
  }));
}

function mapTrimRow(row: Record<string, unknown>): TrimWithContext {
  const my = row.model_years as Record<string, unknown>;
  const model = my.models as Record<string, unknown>;
  const make = model.makes as Record<string, unknown>;

  return {
    id: row.id as string,
    model_year_id: row.model_year_id as string,
    name: row.name as string,
    msrp: row.msrp as number | null,
    invoice: row.invoice as number | null,
    engine: row.engine as string | null,
    hp: row.hp as number | null,
    torque: row.torque as number | null,
    transmission: row.transmission as string | null,
    drivetrain: row.drivetrain as string | null,
    fuel_type: row.fuel_type as string | null,
    mpg_city: row.mpg_city as number | null,
    mpg_highway: row.mpg_highway as number | null,
    mpg_combined: row.mpg_combined as number | null,
    cargo_cu_ft: row.cargo_cu_ft as number | null,
    seating_capacity: row.seating_capacity as number | null,
    towing_lbs: row.towing_lbs as number | null,
    curb_weight_lbs: row.curb_weight_lbs as number | null,
    annual_fuel_cost: row.annual_fuel_cost as number | null,
    co2_tailpipe: row.co2_tailpipe as number | null,
    model_year: {
      id: my.id as string,
      model_id: my.model_id as string,
      year: my.year as number,
      is_current: my.is_current as boolean,
    },
    model: {
      id: model.id as string,
      make_id: model.make_id as string,
      name: model.name as string,
      body_style: model.body_style as string | null,
      segment: model.segment as string | null,
    },
    make: {
      id: make.id as string,
      name: make.name as string,
      country: make.country as string | null,
      logo_url: (make.logo_url as string | null) ?? null,
    },
  };
}
