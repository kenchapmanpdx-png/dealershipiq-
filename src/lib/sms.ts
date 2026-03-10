// Sinch Conversation API SMS send + helpers
// Build Master: Phase 2A, 2A.2
// All outbound sends go through this module.
// Rule: service-db.ts handles DB, this handles SMS transport.

import { getSinchAccessToken } from '@/lib/sinch-auth';
import type { SinchSendMessageRequest, SinchSendMessageResponse } from '@/types/sinch';

const SINCH_REGION = 'https://us.conversation.api.sinch.com';

export async function sendSms(
  phone: string,
  text: string,
  metadata?: string
): Promise<SinchSendMessageResponse> {
  const projectId = process.env.SINCH_PROJECT_ID;
  const appId = process.env.SINCH_APP_ID;
  if (!projectId || !appId) {
    throw new Error('SINCH_PROJECT_ID and SINCH_APP_ID must be set');
  }

  const token = await getSinchAccessToken();

  const body: SinchSendMessageRequest = {
    app_id: appId,
    recipient: {
      identified_by: {
        channel_identities: [{ channel: 'SMS', identity: phone }],
      },
    },
    message: {
      text_message: { text },
    },
    channel_priority_order: ['SMS'],
    ...(metadata ? { message_metadata: metadata } : {}),
  };

  const res = await fetch(
    `${SINCH_REGION}/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Sinch send failed: ${res.status} ${errBody}`);
  }

  return res.json();
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
  text: string
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
  for (const pattern of NATURAL_OPT_OUT_PATTERNS) {
    if (pattern.test(trimmed) && trimmed.length < 60) return 'opt_out';
  }

  return null;
}

// --- HELP response (CTIA compliant) ---
// Build Master 2E: program name, frequency, support contact, opt-out instruction
export function helpResponse(dealershipName: string): string {
  return `DealershipIQ: Daily sales training for ${dealershipName}. Up to 3 msgs/day. Support: support@dealershipiq.com. Reply STOP to opt out. Msg&data rates apply.`;
}
