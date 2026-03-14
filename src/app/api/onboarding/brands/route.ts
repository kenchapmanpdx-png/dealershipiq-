// POST /api/onboarding/brands
// Phase 5: Save selected brands for a dealership during onboarding

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

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

  // M-017: Single source of truth — dealership_brands table only (no settings fallback)
  try {
    const brandRows = brands.map((brand: string) => ({
      dealership_id: dealershipId,
      brand_name: brand,
    }));

    const { error } = await serviceClient
      .from('dealership_brands')
      .upsert(brandRows, { onConflict: 'dealership_id,brand_name' });

    if (error) {
      console.error('Brands upsert failed:', error.message);
      return NextResponse.json({ error: 'Failed to save brands' }, { status: 500 });
    }
  } catch (err) {
    console.error('Brands save error:', err);
    return NextResponse.json({ error: 'Failed to save brands' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
