'use client';

import { useState, useEffect } from 'react';

interface Message {
  from: 'system' | 'rep' | 'ai';
  text: string;
  delay: number; // ms before this message appears
}

const conversation: Message[] = [
  {
    from: 'system',
    text: "A customer says: \"I can get the same truck cheaper at the dealer down the road.\" How do you respond?",
    delay: 800,
  },
  {
    from: 'rep',
    text: "I'd say: \"I appreciate you doing your homework! Let's compare apples to apples — can you share what they quoted? Often the difference comes down to warranty coverage, service packages, or financing terms that save you more long-term.\"",
    delay: 2800,
  },
  {
    from: 'ai',
    text: '⭐ Score: 9.2/10 — Strong reframe. You acknowledged the objection without being defensive, then redirected to value comparison. Excellent use of the "apples to apples" technique.',
    delay: 5200,
  },
];

export default function PhoneMockup() {
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const [cycle, setCycle] = useState(0);

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
      }, 9000)
    );

    return () => timers.forEach(clearTimeout);
  }, [cycle]);

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

          {/* Messages area */}
          <div className="px-3 py-4 min-h-[340px] sm:min-h-[380px] flex flex-col gap-3">
            {conversation.slice(0, visibleMessages).map((msg, i) => (
              <div
                key={i}
                className={`max-w-[92%] animate-[message-in_0.4s_ease-out_both] ${
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
                  {msg.from === 'system' ? 'DealershipIQ' : msg.from === 'rep' ? 'You' : 'AI Coach'}
                </p>
              </div>
            ))}

            {/* Typing indicator */}
            {visibleMessages < conversation.length && visibleMessages > 0 && (
              <div className="self-start">
                <div className="bg-white/8 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_200ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-[bounce_1.4s_infinite_400ms]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Glow effect behind phone */}
      <div className="absolute -inset-8 -z-10 bg-blue-500/10 blur-3xl rounded-full" />
    </div>
  );
}
