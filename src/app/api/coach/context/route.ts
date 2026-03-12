// GET /api/coach/context — Load rep training context (internal, service_role)
// Phase 4.5A: Coach Mode MVP
// Not exposed directly to client — called internally by session route

import { NextRequest, NextResponse } from 'next/server';
import { buildRepContext } from '@/lib/coach/context';

export async function GET(request: NextRequest) {
  // Internal route — verify admin API key or service role
  const adminKey = request.headers.get('x-admin-key');
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = request.nextUrl.searchParams.get('user_id');
  const dealershipId = request.nextUrl.searchParams.get('dealership_id');

  if (!userId || !dealershipId) {
    return NextResponse.json(
      { error: 'user_id and dealership_id required' },
      { status: 400 }
    );
  }

  try {
    const context = await buildRepContext(userId, dealershipId);
    return NextResponse.json({ data: context, error: null });
  } catch (err) {
    console.error('Coach context error:', err);
    return NextResponse.json(
      { error: 'Failed to load rep context' },
      { status: 500 }
    );
  }
}
