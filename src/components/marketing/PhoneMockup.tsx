'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
  from: 'system' | 'rep' | 'ai';
  text: string;
  delay: number; // ms before this message appears
}

const conversation: Message[] = [
  // Persona: young dad, loves the SUV, but his wife isn't sold yet
  {
    from: 'system',
    text: "\"We like it, but my wife wants to check out the Hyundai down the street too.\"",
    delay: 1000,
  },
  {
    from: 'rep',
    text: "Smart to compare. What's she hoping the Hyundai might offer that this one doesn't?",
    delay: 3600,
  },
  // Exchange 2 — the real concern surfaces
  {
    from: 'system',
    text: "\"She just thinks we'd be paying too much for the brand.\"",
    delay: 6600,
  },
  {
    from: 'rep',
    text: "That's fair. Want me to pull up warranty and resale side by side? Might help the conversation at home.",
    delay: 9600,
  },
  // Exchange 3 — he's warming up, needs ammo for his wife
  {
    from: 'system',
    text: "\"Yeah actually that'd help. She's the spreadsheet person.\"",
    delay: 12600,
  },
  {
    from: 'rep',
    text: "Love that. I'll put together a quick comparison you can show her tonight.",
    delay: 15600,
  },
  // AI grade
  {
    from: 'ai',
    text: '⭐ 9.1/10 — Respected the co-buyer dynamic instead of pushing a solo close. 💡 Offer to include her on a follow-up call.',
    delay: 18900,
  },
];

export default function PhoneMockup() {
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const [cycle, setCycle] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    conversation.forEach((msg, i) => {
      timers.push(
        setTimeout(() => {
          setVisibleMessages(i + 1);
        }, msg.delay)
      );
    });

    // Loop the animation
    timers.push(
      setTimeout(() => {
        setVisibleMessages(0);
        setCycle((c) => c + 1);
      }, 24000)
    );

    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [visibleMessages]);

  return (
    <div className="relative mx-auto w-[280px] sm:w-[320px]">
      {/* Phone frame */}
      <div className="relative rounded-[2.5rem] border-2 border-white/10 bg-[#0c0c0f] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)]">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-[#0c0c0f] rounded-b-2xl z-10" />

        {/* Screen */}
        <div className="rounded-[2rem] bg-[#111114] overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pt-3 pb-2 text-[10px] text-white/60">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" />
              </svg>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
              </svg>
            </div>
          </div>

          {/* Header */}
          <div className="px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <span className="text-xs font-bold text-white">IQ</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">DealershipIQ</p>
                <p className="text-[10px] text-white/40">Training</p>
              </div>
            </div>
          </div>

          {/* Messages area — fixed height, scrolls like a real phone */}
          <div
            ref={scrollRef}
            className="px-3 py-4 h-[340px] sm:h-[380px] overflow-y-auto flex flex-col gap-3"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <style jsx>{`
              div::-webkit-scrollbar { display: none; }
            `}</style>
            {conversation.slice(0, visibleMessages).map((msg, i) => (
              <div
                key={i}
                className={`max-w-[92%] shrink-0 animate-[message-in_0.4s_ease-out_both] ${
                  msg.from === 'rep' ? 'self-end' : 'self-start'
                }`}
              >
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-[11px] leading-relaxed ${
                    msg.from === 'rep'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : msg.from === 'ai'
                        ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-100 rounded-bl-md'
                        : 'bg-white/8 text-white/90 rounded-bl-md'
                  }`}
                >
                  {msg.text}
                </div>
                <p className={`text-[9px] text-white/30 mt-1 ${
                  msg.from === 'rep' ? 'text-right' : ''
                }`}>
                  {msg.from === 'system' ? 'Customer' : msg.from === 'rep' ? 'You' : 'AI Coach'}
                </p>
              </div>
            ))}

            {/* Typing indicator */}
            {visibleMessages < conversation.length && visibleMessages > 0 && (
              <div className="self-start shrink-0">
                <div className="bg-white/8 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_200ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_400ms]" />
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Glow effect behind phone */}
      <div className="absolute -inset-8 -z-10 bg-blue-500/10 blur-3xl rounded-full" />
    </div>
  );
}
