// POST /api/onboarding/brands
// Phase 5: Save selected brands for a dealership during onboarding
// C-003: Migrated to RLS client. dealership_brands has FOR ALL policy.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { requireJsonContentType } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  // L-14: content-type gate
  const ctErr = requireJsonContentType(request);
  if (ctErr) return ctErr;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dealershipId = user.app_metadata?.dealership_id as string;
  if (!dealershipId) {
    return NextResponse.json({ error: 'No dealership' }, { status: 403 });
  }

  // H-001: Verify user has manager/owner role
  const userRole = user.app_metadata?.user_role as string;
  if (!userRole || !['owner', 'manager'].includes(userRole)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { brands } = await request.json();
  if (!Array.isArray(brands) || brands.length === 0) {
    return NextResponse.json({ error: 'Brands required' }, { status: 400 });
  }

  // V4-M-005: Validate brand string length/content
  const MAX_BRANDS = 50;
  const MAX_BRAND_LENGTH = 100;
  if (brands.length > MAX_BRANDS) {
    return NextResponse.json({ error: `Too many brands (max ${MAX_BRANDS})` }, { status: 400 });
  }
  for (const b of brands) {
    if (typeof b !== 'string' || b.trim().length === 0 || b.length > MAX_BRAND_LENGTH) {
      return NextResponse.json({ error: 'Invalid brand name' }, { status: 400 });
    }
  }

  // M-017: Single source of truth — dealership_brands table only (no settings fallback)
  // 2026-07-05 AUDIT #3: dealership_brands has make_id (NOT NULL, FK→makes),
  // not brand_name — the old upsert threw on every call, so onboarding brand
  // save always failed AND brand grounding (getDealershipBrandNames) had no
  // data. Resolve names→makes (create missing makes via service client:
  // makes has no manager INSERT policy), then upsert on (dealership_id, make_id).
  try {
    const names = Array.from(new Set(brands.map((b: string) => b.trim()).filter(Boolean)));

    // Resolve existing makes case-insensitively
    const { data: existingMakes, error: makesErr } = await serviceClient
      .from('makes')
      .select('id, name');
    if (makesErr) throw makesErr;
    const makeIdByLower = new Map(
      (existingMakes ?? []).map((m) => [(m.name as string).toLowerCase(), m.id as string])
    );

    // Create any missing makes (name is UNIQUE)
    const missing = names.filter((n) => !makeIdByLower.has(n.toLowerCase()));
    if (missing.length > 0) {
      const { data: created, error: createErr } = await serviceClient
        .from('makes')
        .upsert(missing.map((name) => ({ name })), { onConflict: 'name' })
        .select('id, name');
      if (createErr) throw createErr;
      for (const m of created ?? []) {
        makeIdByLower.set((m.name as string).toLowerCase(), m.id as string);
      }
    }

    const brandRows = names.map((name) => ({
      dealership_id: dealershipId,
      make_id: makeIdByLower.get(name.toLowerCase())!,
    }));

    // C-003: RLS-backed — dealership_brands FOR ALL policy
    const { error } = await supabase
      .from('dealership_brands')
      .upsert(brandRows, { onConflict: 'dealership_id,make_id' });

    if (error) {
      console.error('Brands upsert failed:', error.message);
      return NextResponse.json({ error: 'Failed to save brands' }, { status: 500 });
    }
  } catch (err) {
    console.error('Brands save error:', (err as Error).message ?? err);
    return NextResponse.json({ error: 'Failed to save brands' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
