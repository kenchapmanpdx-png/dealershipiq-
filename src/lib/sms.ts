// Sinch SMS send + helpers
// Build Master: Phase 2A, 2A.2
// All outbound sends go through this module.
// Rule: service-db.ts handles DB, this handles SMS transport.
//
// Uses the SMS REST API (XMS) directly instead of the Conversation API.
// Reason: Conversation API outbound fails with delivery code 61 because
// the XMS adapter cannot resolve the sender number (channel_known_id empty
// and not settable via API). The REST API sends successfully.

export interface SmsSendResult {
  id: string;
  message_id: string; // alias for id — compatibility with callers expecting Conversation API format
  to: string[];
  from: string;
}

// --- GSM-7 Sanitization ---
export function sanitizeGsm7(text: string): string {
  let result = text;

  // Replace smart/curly quotes with straight quotes
  result = result.replace(/[""]/g, '"');
  result = result.replace(/['']/g, "'");

  // Replace dashes with hyphen
  result = result.replace(/[–—]/g, '-');

  // Replace ellipsis character with three dots
  result = result.replace(/…/g, '...');

  // Strip any remaining non-GSM-7 characters (emoji, etc.)
  const gsm7Chars = new Set(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    'ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà'
  );

  result = result.split('').filter(char => gsm7Chars.has(char)).join('');

  return result;
}

// S-006 + C-010: Real-time opt-out check before any SMS send (TCPA compliance)
// FAIL-CLOSED: returns true (block SMS) on ANY error. TCPA fine: $500-$1,500/message.
async function isOptedOut(phone: string): Promise<boolean> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('[TCPA] isOptedOut: missing SUPABASE env vars — blocking SMS send');
      return true; // Fail-closed: block send if DB unreachable
    }

    const client = createClient(url, key);
    const normalized = phone.startsWith('+') ? phone : `+${phone}`;
    const alt = normalized.replace(/^\+/, '');

    const { data, error } = await client
      .from('sms_opt_outs')
      .select('id')
      .or(`phone.eq.${normalized},phone.eq.${alt}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[TCPA] isOptedOut: DB query error — blocking SMS send:', error.message);
      return true; // Fail-closed on query error
    }

    return !!data;
  } catch (err) {
    console.error('[TCPA] isOptedOut: unexpected error — blocking SMS send:', err);
    return true; // Fail-closed on any exception
  }
}

export async function sendSms(
  phone: string,
  text: string,
  _metadata?: string
): Promise<SmsSendResult> {
  const servicePlanId = process.env.SINCH_SERVICE_PLAN_ID;
  const apiToken = process.env.SINCH_API_TOKEN;
  const fromNumber = process.env.SINCH_PHONE_NUMBER;

  if (!servicePlanId || !apiToken || !fromNumber) {
    throw new Error('SINCH_SERVICE_PLAN_ID, SINCH_API_TOKEN, and SINCH_PHONE_NUMBER must be set');
  }

  // S-006: TCPA real-time opt-out check before every outbound SMS
  if (await isOptedOut(phone)) {
    console.warn(`Blocked SMS to opted-out number: ${phone.slice(-4)}`);
    return { id: 'blocked-opt-out', message_id: 'blocked-opt-out', to: [phone], from: fromNumber };
  }

  // Sanitize for GSM-7 before sending
  let sanitized = sanitizeGsm7(text);

  // V4-C-001/RT-005: Hard enforcement — truncate if >320 chars (2-segment max).
  // Log warning for multi-segment (>160 chars).
  if (sanitized.length > 320) {
    console.error(`[SMS] Truncating message from ${sanitized.length} to 317 chars for ***${phone.slice(-4)}`);
    sanitized = sanitized.slice(0, 317) + '...';
  } else if (sanitized.length > 160) {
    console.warn(`[SMS] Multi-segment message (${sanitized.length} chars) to ***${phone.slice(-4)}`);
  }

  // Strip leading + from phone numbers for XMS API
  const to = phone.replace(/^\+/, '');
  const from = fromNumber.replace(/^\+/, '');

  const res = await fetch(
    `https://us.sms.api.sinch.com/xms/v1/${servicePlanId}/batches`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ from, to: [to], body: sanitized }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Sinch SMS send failed: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return { ...data, message_id: data.id };
}

// --- GSM-7 validation ---
// Standard GSM-7 charset. Messages outside this charset use UCS-2 (70 char limit vs 160).
const GSM7_CHARS = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà'
);

export function isGsm7(text: string): boolean {
  for (const char of text) {
    if (!GSM7_CHARS.has(char)) return false;
  }
  return true;
}

export function smsSegmentCount(text: string): number {
  if (isGsm7(text)) {
    return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
  }
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

// --- Keyword detection ---
// Build Master 2E: STOP/END/CANCEL/QUIT/UNSUBSCRIBE are intercepted by Sinch
// and never reach our webhook. These are for natural language opt-outs.

const NATURAL_OPT_OUT_PATTERNS = [
  /\bplease stop\b/i,
  /\bstop texting\b/i,
  /\bremove me\b/i,
  /\bopt out\b/i,
  /\bopt me out\b/i,
  /\bunsubscribe\b/i,
  /\bdejar de enviar\b/i,
  /\bno m[aá]s mensajes\b/i,
];

const SPANISH_OPT_OUT_EXACT = new Set(['parar', 'cancelar']);

const HELP_KEYWORDS = new Set(['help', 'info', 'ayuda']);

export function detectKeyword(
  text: string,
  hasActiveSession?: boolean
): 'opt_out' | 'help' | 'start' | null {
  const trimmed = text.trim().toLowerCase();

  // Exact-match help keywords
  if (HELP_KEYWORDS.has(trimmed)) return 'help';

  // Exact-match Spanish opt-out
  if (SPANISH_OPT_OUT_EXACT.has(trimmed)) return 'opt_out';

  // START/YES/UNSTOP re-subscribe
  if (['start', 'yes', 'unstop'].includes(trimmed)) return 'start';

  // Natural language opt-out patterns
  // Important: only match when the ENTIRE message is an opt-out request,
  // not when "stop" appears inside a training response like "stop the customer said..."
  // Skip natural patterns if user has an active session (could be part of training response)
  if (!hasActiveSession) {
    for (const pattern of NATURAL_OPT_OUT_PATTERNS) {
      if (pattern.test(trimmed) && trimmed.length < 60) return 'opt_out';
    }
  }

  return null;
}

// --- HELP response (CTIA compliant) ---
// Build Master 2E: program name, frequency, support contact, opt-out instruction
// H-014: Must fit in single SMS segment (<=160 chars) for reliable TCPA delivery.
export function helpResponse(dealershipName: string): string {
  // Truncate dealership name if needed to keep total <=160 chars
  // Template without name: "DealershipIQ training for . 3 msgs/day max. support@dealershipiq.com STOP to opt out" = ~87 chars
  const maxNameLen = 70;
  const name = dealershipName.length > maxNameLen ? dealershipName.slice(0, maxNameLen) : dealershipName;
  return `DealershipIQ training for ${name}. 3 msgs/day max. support@dealershipiq.com STOP to opt out`;
}
