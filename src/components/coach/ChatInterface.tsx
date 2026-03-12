// Coach Mode chat interface
// Phase 4.5A — text-only, no voice

'use client';

import { useState, useRef, useEffect } from 'react';
import type { CoachMessage } from '@/types/coach';

interface ChatInterfaceProps {
  sessionId: string;
  initialMessages: CoachMessage[];
  token: string;
  onSessionClosed?: () => void;
}

export default function ChatInterface({
  sessionId,
  initialMessages,
  token,
  onSessionClosed,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<CoachMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');

    // Optimistic add user message
    const userMsg: CoachMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/coach/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-diq-session': token,
        },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });

      const data = await res.json();

      if (data.data?.session_closed) {
        onSessionClosed?.();
        return;
      }

      if (data.data?.messages) {
        // Add only coach responses (user message already added optimistically)
        const coachMsgs = data.data.messages.filter(
          (m: CoachMessage) => m.role === 'assistant'
        );
        setMessages((prev) => [...prev, ...coachMsgs]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant' as const,
          content: 'Connection error. Your message was saved — try again in a moment.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <p
                className={`text-[10px] mt-1 ${
                  msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'
                }`}
              >
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 safe-bottom">
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={sending}
            className="flex-1 border border-gray-300 rounded-full px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center disabled:opacity-40 hover:bg-blue-700 transition flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
