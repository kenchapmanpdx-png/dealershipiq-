'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
  from: 'system' | 'rep' | 'ai';
  text: string;
  delay: number; // ms before this message appears
}

const conversation: Message[] = [
  // Persona: buyer likes the CR-V, needs to "sleep on it"
  {
    from: 'system',
    text: "\"I really like the CR-V, but I think I need to sleep on it.\"",
    delay: 1150,
  },
  {
    from: 'rep',
    text: "I get it. Is it the car you're not sure about, or is it the numbers?",
    delay: 4150,
  },
  // Exchange 2 — real hesitation surfaces, rep creates urgency
  {
    from: 'system',
    text: "\"The numbers mostly. I just don't want to rush into something.\"",
    delay: 7600,
  },
  {
    from: 'rep',
    text: "There's $1,500 in incentives expiring Saturday — let me get you a real out-the-door number so you're comparing facts, not guesses.",
    delay: 11050,
  },
  // Exchange 3 — buyer reveals his number, rep closes
  {
    from: 'system',
    text: "\"I'm really trying to stay under $500 a month.\"",
    delay: 16100,
  },
  {
    from: 'rep',
    text: "If we land on the right number under $500 a month, do we have a deal?",
    delay: 20500,
  },
  // AI grade — praise + correction
  {
    from: 'ai',
    text: '⭐ 8.4/10 — Isolated the hesitation to numbers, not the car. Urgency without pressure. 💡 Ask what he pays now — "Only $40 more for a new CR-V" hits harder than any discount.',
    delay: 25000,
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
      }, 36000)
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
      {/* ── Shine border — rotating neon glow ── */}
      <div
        className="absolute -inset-[3px] rounded-[2.8rem] animate-shine z-0"
        style={{
          backgroundImage:
            'radial-gradient(transparent, transparent, #3b82f6, #8b5cf6, #06b6d4, transparent, transparent)',
          backgroundSize: '300% 300%',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          WebkitMaskComposite: 'xor',
          padding: '3px',
        }}
      />
      {/* Neon glow shadow layers — subtle */}
      <div className="absolute -inset-3 rounded-[3rem] bg-blue-500/[0.022] blur-xl z-0 animate-[glow-pulse_4s_ease-in-out_infinite]" />
      <div className="absolute -inset-6 rounded-[3.5rem] bg-violet-500/[0.012] blur-2xl z-0 animate-[glow-pulse_4s_ease-in-out_infinite_1s]" />

      {/* ── Phone frame — dark silver metallic ── */}
      <div
        className="relative z-10 rounded-[2.6rem] p-[11px] sm:p-3"
        style={{
          background: 'linear-gradient(135deg, #3a3a40 0%, #28282e 30%, #1c1c22 60%, #2a2a30 100%)',
          boxShadow:
            '0 12px 30px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.3)',
        }}
      >
        {/* Metallic edge highlight — thin bright line on top edge */}
        <div
          className="absolute inset-0 rounded-[2.6rem] pointer-events-none z-20"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 8%, transparent 92%, rgba(255,255,255,0.04) 100%)',
          }}
        />

        {/* Side button accents (volume + power) */}
        <div
          className="absolute top-[70px] -left-[1px] w-[2px] h-[22px] rounded-l-sm"
          style={{ background: 'linear-gradient(180deg, #4a4a52, #2a2a30)' }}
        />
        <div
          className="absolute top-[100px] -left-[1px] w-[2px] h-[40px] rounded-l-sm"
          style={{ background: 'linear-gradient(180deg, #4a4a52, #2a2a30)' }}
        />
        <div
          className="absolute top-[148px] -left-[1px] w-[2px] h-[40px] rounded-l-sm"
          style={{ background: 'linear-gradient(180deg, #4a4a52, #2a2a30)' }}
        />
        <div
          className="absolute top-[105px] -right-[1px] w-[2px] h-[55px] rounded-r-sm"
          style={{ background: 'linear-gradient(180deg, #4a4a52, #2a2a30)' }}
        />

        {/* ── Screen ── */}
        <div
          className="relative rounded-[2rem] bg-[#0a0a0e] overflow-hidden"
          style={{
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03), inset 0 8px 16px rgba(0,0,0,0.4), inset 0 -6px 12px rgba(0,0,0,0.3)',
          }}
        >
          {/* Dynamic Island */}
          <div className="absolute top-[10px] left-1/2 -translate-x-1/2 z-30">
            <div
              className="w-[90px] sm:w-[105px] h-[28px] sm:h-[32px] rounded-full bg-black"
              style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.8), inset 0 0 0 0.5px rgba(255,255,255,0.04)',
              }}
            >
              {/* Camera lens inside island */}
              <div className="absolute right-[14px] top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full bg-[#0a0a12] border border-[#1a1a24]">
                <div className="absolute inset-[2px] rounded-full bg-[#0c1020]" />
              </div>
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pt-[14px] pb-1 text-[10px] text-white/60 font-medium">
            <span className="w-12">9:41</span>
            <div className="flex-1" /> {/* Spacer for island */}
            <div className="flex items-center gap-[3px] w-12 justify-end">
              {/* Signal bars */}
              <svg className="w-[14px] h-[10px]" viewBox="0 0 17 10" fill="currentColor">
                <rect x="0" y="7" width="3" height="3" rx="0.5" opacity="1" />
                <rect x="4.5" y="4.5" width="3" height="5.5" rx="0.5" opacity="1" />
                <rect x="9" y="2" width="3" height="8" rx="0.5" opacity="1" />
                <rect x="13.5" y="0" width="3" height="10" rx="0.5" opacity="0.35" />
              </svg>
              {/* WiFi */}
              <svg className="w-[12px] h-[10px]" viewBox="0 0 16 12" fill="currentColor">
                <path d="M8 11.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z" />
                <path d="M4.7 8.3a4.5 4.5 0 016.6 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M2.2 5.8a8 8 0 0111.6 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {/* Battery */}
              <svg className="w-[20px] h-[9px]" viewBox="0 0 25 11">
                <rect x="0" y="0.5" width="21" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                <rect x="1.5" y="2" width="14" height="7" rx="1.2" fill="currentColor" opacity="0.6" />
                <path d="M22.5 4v3a1.5 1.5 0 000-3z" fill="currentColor" opacity="0.35" />
              </svg>
            </div>
          </div>

          {/* Header */}
          <div className="px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-[0_0_8px_rgba(59,130,246,0.4)]">
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
            className="px-3 py-4 h-[409px] sm:h-[469px] overflow-y-auto flex flex-col gap-3"
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

          {/* Home indicator */}
          <div className="flex justify-center pb-2 pt-1">
            <div
              className="w-[100px] sm:w-[120px] h-[4px] rounded-full"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.3))',
              }}
            />
          </div>
        </div>
      </div>

      {/* Ambient glow behind phone — subtle */}
      <div className="absolute -inset-14 -z-10 bg-blue-500/[0.012] blur-[60px] rounded-full" />
      <div className="absolute -inset-20 -z-20 bg-violet-500/[0.006] blur-[100px] rounded-full" />
    </div>
  );
}
