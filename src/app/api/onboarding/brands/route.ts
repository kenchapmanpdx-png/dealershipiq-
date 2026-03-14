// POST /api/onboarding/brands
// Phase 5: Save selected brands for a dealership during onboarding
// C-003: Migrated to RLS client. dealership_brands has FOR ALL policy.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
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
  try {
    const brandRows = brands.map((brand: string) => ({
      dealership_id: dealershipId,
      brand_name: brand,
    }));

    // C-003: RLS-backed — dealership_brands FOR ALL policy
    const { error } = await supabase
      .from('dealership_brands')
      .upsert(brandRows, { onConflict: 'dealership_id,brand_name' });

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
