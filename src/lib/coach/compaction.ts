// Coach Mode message compaction — Phase 4.5A
// For sessions > 10 exchanges, compress older messages to manage context window.
// Strategy: first 8 messages → GPT-4o-mini synopsis (~200 tokens) + last 4 messages full.

import type { CoachMessage } from '@/types/coach';
import { tokenLimitParam } from '@/lib/openai';

interface CompactedHistory {
  synopsis: string | null;
  recentMessages: CoachMessage[];
}

const MAX_EXCHANGES = 20; // 10 user + 10 coach
const COMPACTION_THRESHOLD = 10; // messages (not exchanges)

export function needsCompaction(messages: CoachMessage[]): boolean {
  return messages.length > COMPACTION_THRESHOLD;
}

export function isAtExchangeLimit(messages: CoachMessage[]): number {
  const userMessages = messages.filter((m) => m.role === 'user');
  return userMessages.length;
}

export function isMaxExchanges(messages: CoachMessage[]): boolean {
  return isAtExchangeLimit(messages) >= MAX_EXCHANGES / 2;
}

export async function compactMessages(
  messages: CoachMessage[]
): Promise<CompactedHistory> {
  if (!needsCompaction(messages)) {
    return { synopsis: null, recentMessages: messages };
  }

  const earlyMessages = messages.slice(0, 8);
  const recentMessages = messages.slice(-4);

  // Summarize early messages via GPT-4o-mini
  const synopsis = await summarizeMessages(earlyMessages);

  return { synopsis, recentMessages };
}

export function buildMessageHistory(
  compacted: CompactedHistory,
  systemPrompt: string
): Array<{ role: 'system' | 'assistant' | 'user'; content: string }> {
  const history: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (compacted.synopsis) {
    history.push({
      role: 'system',
      content: `[Earlier conversation summary: ${compacted.synopsis}]`,
    });
  }

  for (const msg of compacted.recentMessages) {
    history.push({ role: msg.role, content: msg.content });
  }

  return history;
}

async function summarizeMessages(messages: CoachMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return formatFallbackSummary(messages);

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'Rep' : 'Coach'}: ${m.content}`)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content:
              'Summarize this coaching conversation excerpt in under 100 words. Capture: main topic discussed, key advice given, rep emotions expressed, and any commitments made. Be factual and concise.',
          },
          { role: 'user', content: transcript },
        ],
        ...tokenLimitParam('gpt-4o-mini-2024-07-18', 200),
        temperature: 0.3,
      }),
    });

    if (!res.ok) return formatFallbackSummary(messages);

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? formatFallbackSummary(messages);
  } catch {
    return formatFallbackSummary(messages);
  }
}

function formatFallbackSummary(messages: CoachMessage[]): string {
  // Simple extractive fallback — first and last message snippets
  const first = messages[0];
  const last = messages[messages.length - 1];
  const firstSnip = first?.content.slice(0, 100) ?? '';
  const lastSnip = last?.content.slice(0, 100) ?? '';
  return `Conversation started with: "${firstSnip}..." Most recent: "${lastSnip}..."`;
}
