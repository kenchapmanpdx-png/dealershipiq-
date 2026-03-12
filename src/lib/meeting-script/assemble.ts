// Phase 4.5B: Morning Meeting Script assembly.
// Two formats from same data: SMS brief (320 chars max, GSM-7) + full_script JSONB.
// NO LLM calls — pure template assembly.

import type {
  MeetingScriptData,
  MeetingScriptFullScript,
} from '@/types/meeting-script';

/** Build the SMS brief text. Max 320 chars (2 SMS segments). GSM-7 only, no emoji. */
export function buildMeetingSMS(data: MeetingScriptData): string {
  const lines: string[] = [];
  lines.push(`Morning Intel - ${data.dealershipName}`);

  if (data.shoutout) {
    lines.push(
      `Top: ${data.shoutout.name} (${data.shoutout.score}%, ${abbreviateDomain(data.shoutout.domain)}).`
    );
  }

  if (data.gap) {
    lines.push(
      `Gap: ${data.gap.count} asked about ${truncate(data.gap.topic, 30)}.`
    );
  }

  lines.push(
    `Completion: ${data.numbers.completion_rate}% (${formatDelta(data.numbers.delta)} vs last wk).`
  );

  if (data.atRisk.length > 0) {
    lines.push(
      `Check in: ${data.atRisk.map((r) => r.name).join(', ')}.`
    );
  }

  if (data.benchmark) {
    lines.push(
      `Rank: #${data.benchmark.rank} of ${data.benchmark.total} ${data.benchmark.brand} stores.`
    );
  }

  lines.push('Reply DETAILS for full meeting script.');

  let sms = lines.join(' ');

  // Enforce 320 char limit: trim low-priority sections
  if (sms.length > 320) {
    // Remove benchmark line first
    const benchmarkIdx = lines.findIndex((l) => l.startsWith('Rank:'));
    if (benchmarkIdx !== -1) {
      lines.splice(benchmarkIdx, 1);
      sms = lines.join(' ');
    }
  }

  if (sms.length > 320) {
    // Truncate gap detail
    const gapIdx = lines.findIndex((l) => l.startsWith('Gap:'));
    if (gapIdx !== -1) {
      lines[gapIdx] = `Gap: ${data.gap?.count ?? 0} knowledge gaps this week.`;
      sms = lines.join(' ');
    }
  }

  if (sms.length > 320) {
    // Last resort: trim at-risk to first name only
    const checkIdx = lines.findIndex((l) => l.startsWith('Check in:'));
    if (checkIdx !== -1 && data.atRisk.length > 1) {
      lines[checkIdx] = `Check in: ${data.atRisk[0].name} +${data.atRisk.length - 1} more.`;
      sms = lines.join(' ');
    }
  }

  // Hard trim as absolute safety net
  if (sms.length > 320) {
    sms = sms.slice(0, 317) + '...';
  }

  return sms;
}

/** Build the full_script JSONB for dashboard storage. */
export function buildFullScript(data: MeetingScriptData): MeetingScriptFullScript {
  return {
    shoutout: data.shoutout,
    gap: data.gap,
    coaching_focus: data.coachingFocus,
    at_risk: data.atRisk,
    numbers: data.numbers,
    benchmark: data.benchmark,
  };
}

/** Format full script as multi-segment SMS for DETAILS response (max ~612 chars / 4 segments). */
export function formatDetailsResponse(
  dealershipName: string,
  script: MeetingScriptFullScript,
  scriptDate: string
): string {
  const lines: string[] = [];
  lines.push(`Morning Intel - ${dealershipName} - ${scriptDate}`);
  lines.push('');

  if (script.shoutout) {
    lines.push(
      `SHOUTOUT: ${script.shoutout.name} scored ${script.shoutout.score}% on ${script.shoutout.domain}. Ask them to share their approach.`
    );
  }

  if (script.gap) {
    let gapLine = `GAP: ${script.gap.count} asked about ${script.gap.topic}.`;
    if (script.gap.answer) {
      gapLine += ` Answer: ${script.gap.answer}`;
    }
    lines.push(gapLine);
  }

  if (script.coaching_focus) {
    lines.push(
      `FOCUS (${script.coaching_focus.domain}): "${truncate(script.coaching_focus.prompt, 120)}"`
    );
  }

  if (script.at_risk.length > 0) {
    const names = script.at_risk
      .map((r) => `${r.name} (${r.signal})`)
      .join(', ');
    lines.push(`PRIVATE: ${names}`);
  }

  lines.push(
    `NUMBERS: ${script.numbers.completion_rate}% completion (${formatDelta(script.numbers.delta)} vs last wk).`
  );

  if (script.benchmark) {
    lines.push(
      `Rank: #${script.benchmark.rank} of ${script.benchmark.total} ${script.benchmark.brand} stores.`
    );
  }

  let text = lines.filter(Boolean).join(' ');

  // Cap at 612 chars (4 SMS segments GSM-7)
  if (text.length > 612) {
    text = text.slice(0, 609) + '...';
  }

  return text;
}

function abbreviateDomain(domain: string): string {
  const abbrevs: Record<string, string> = {
    'objection handling': 'objections',
    'product knowledge': 'product',
    'closing technique': 'closing',
    'competitive positioning': 'competitive',
    financing: 'financing',
  };
  return abbrevs[domain] ?? domain;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}%`;
  if (delta < 0) return `${delta}%`;
  return '0%';
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
