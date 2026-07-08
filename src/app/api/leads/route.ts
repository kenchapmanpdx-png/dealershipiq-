// Public lead-capture endpoint for the marketing landing page.
// POST /api/leads — validates, rate-limits per IP (fails open until Upstash
// is configured, matching house posture), inserts via service-db.
//
// Abuse posture: honeypot field ("company") silently drops bots; all string
// inputs are length-clamped; email shape-checked. No auth by design — this
// is a public form.

import { NextRequest, NextResponse } from 'next/server';
import { insertMarketingLead } from '@/lib/service-db';
import { checkSignupLimit } from '@/lib/rate-limit';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clamp(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const rl = await checkSignupLimit(ip);
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Honeypot: real users never see this field; bots fill it. Return ok so
    // the bot believes it succeeded, write nothing.
    if (clamp((body as Record<string, unknown>).company, 10) !== '') {
      return NextResponse.json({ ok: true });
    }

    const b = body as Record<string, unknown>;
    const firstName = clamp(b.first, 100);
    const lastName = clamp(b.last, 100);
    const email = clamp(b.email, 200);
    const phone = clamp(b.phone, 40);
    const dealershipName = clamp(b.dealership, 200);
    const teamSize = clamp(b.size, 20);
    const role = clamp(b.role, 60);
    const notes = clamp(b.notes, 2000);

    if (!firstName || !lastName || !dealershipName || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    await insertMarketingLead({
      firstName,
      lastName,
      email,
      phone: phone || null,
      dealershipName,
      teamSize: teamSize || null,
      role: role || null,
      notes: notes || null,
    });

    log.info('marketing_lead.captured', { email, dealership: dealershipName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('marketing_lead.failed', { err: (err as Error).message });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
