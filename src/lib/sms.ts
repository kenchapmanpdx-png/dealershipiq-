// Sinch SMS send + helpers
// Build Master: Phase 2A, 2A.2
// All outbound sends go through this module.
// Rule: service-db.ts handles DB, this handles SMS transport.
//
// Uses the SMS REST API (XMS) directly instead of the Conversation API.
// Reason: Conversation API outbound fails with delivery code 61 because
// the XMS adapter cannot resolve the sender number (channel_known_id empty
// and not settable via API). The REST API sends successfully.
//
// v2: Raised SMS hard cap from 320 (2 segments) to 480 (3 segments) to
//     accommodate richer grading feedback with word tracks + example responses.

export interface SmsSendResult {
  id: string;
  message_id: string; // alias for id -- compatibility with callers expecting Conversation API format
  to: string[];
  from: string;
}

// --- GSM-7 Sanitization ---
export function sanitizeGsm7(text: string): string {
  let result = text;

  // Replace smart/curly quotes with straight quotes
  result = result.replace(/[\u201C\u201D]/g, '"');
  result = result.replace(/[\u2018\u2019]/g, "'");

  // Replace dashes with hyphen
  result = result.replace(/[\u2013\u2014]/g, '-');

  // Replace ellipsis character with three dots
  result = result.replace(/\u2026/g, '...');

  // Strip any remaining non-GSM-7 characters (emoji, etc.)
  const gsm7Chars = new Set(
    '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E \u00C6\u00E6\u00DF\u00C9 !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    '\u00C4\u00D6\u00D1\u00DC\u00A7abcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0'
  );

  result = result.split('').filter(char => gsm7Chars.has(char)).join('');

  return result;
}

// S-006 + C-010: Real-time opt-out check before any SMS send (TCPA compliance)
// FAIL-CLOSED: returns true (block SMS) on ANY error. TCPA fine: $500-$1,500/message.
// CF-M-001: Uses shared serviceClient instead of creating a new client per call.
async function isOptedOut(phone: string): Promise<boolean> {
  try {
    const { serviceClient } = await import('@/lib/supabase/service');
    const normalized = phone.startsWith('+') ? phone : `+${phone}`;
    const alt = normalized.replace(/^\+/, '');

    const { data, error } = await serviceClient
      .from('sms_opt_outs')
      .select('id')
      .or(`phone.eq.${normalized},phone.eq.${alt}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[TCPA] isOptedOut: DB query error -- blocking SMS send:', error.message);
      return true; // Fail-closed on query error
    }

    return !!data;
  } catch (err) {
    console.error('[TCPA] isOptedOut: unexpected error -- blocking SMS send:', err);
    return true; // Fail-closed on any exception
  }
}

export async function sendSms(
  phone: string,
  text: string,
  _metadata?: string
): Promise<SmsSendResult> {
  // F4-H-001: Global SMS kill switch. Set ENABLE_SMS_SEND=false to disable all outbound.
  if (process.env.ENABLE_SMS_SEND === 'false') {
    console.log(`[SMS] Send disabled via ENABLE_SMS_SEND. Would have sent to ***${phone.slice(-4)}`);
    return { id: 'disabled', message_id: 'disabled', to: [phone], from: process.env.SINCH_PHONE_NUMBER ?? '' };
  }

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

  // v2: Hard cap raised to 480 chars (3 segments) to accommodate richer grading feedback.
  // Grading responses with word tracks + example responses typically run 300-450 chars.
  if (sanitized.length > 480) {
    console.error(`[SMS] Truncating message from ${sanitized.length} to 477 chars for ***${phone.slice(-4)}`);
    sanitized = sanitized.slice(0, 477) + '...';
  } else if (sanitized.length > 160) {
    console.warn(`[SMS] Multi-segment message (${sanitized.length} chars, ${smsSegmentCount(sanitized)} segments) to ***${phone.slice(-4)}`);
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
  '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E \u00C6\u00E6\u00DF\u00C9 !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  '\u00C4\u00D6\u00D1\u00DC\u00A7abcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0'
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
  /\bno m[a\u00E1]s mensajes\b/i,
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