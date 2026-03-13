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

  // Insert into dealership_brands (if table exists) or store in settings
  try {
    // Try dealership_brands table first
    const brandRows = brands.map((brand: string) => ({
      dealership_id: dealershipId,
      brand_name: brand,
    }));

    const { error } = await serviceClient
      .from('dealership_brands')
      .upsert(brandRows, { onConflict: 'dealership_id,brand_name' });

    if (error) {
      // Fallback: store in dealership settings
      await serviceClient
        .from('dealerships')
        .update({
          settings: { brands },
        })
        .eq('id', dealershipId);
    }
  } catch {
    // Store in settings as fallback
    await serviceClient
      .from('dealerships')
      .update({
        settings: { brands },
      })
      .eq('id', dealershipId);
  }

  return NextResponse.json({ success: true });
}
