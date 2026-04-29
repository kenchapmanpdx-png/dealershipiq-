// Continue existing coach session
// Phase 4.5A — Loads full session messages and opens chat interface

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRepSession } from '@/lib/pwa/session-context';
import ChatInterface from '@/components/coach/ChatInterface';
import type { CoachMessage } from '@/types/coach';

export default function ContinueSessionPage() {
  const session = useRepSession();
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const slug = params.slug as string;

  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!session || !sessionId) return;

    async function loadSession() {
      try {
        // 2026-04-18 C-2: HttpOnly cookie auto-sent on same-origin requests.
        const res = await fetch('/api/coach/session');
        const data = await res.json();
        const sessions = data.data?.sessions ?? [];
        const current = sessions.find((s: { id: string }) => s.id === sessionId);

        if (!current || current.ended_at) {
          setClosed(true);
          setLoading(false);
          return;
        }

        // We need to get the full message list — the list endpoint only returns preview
        // For MVP, we'll use the messages stored in the session's JSONB
        // POST to continue to check state
        const stateRes = await fetch('/api/coach/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ session_id: sessionId }),
        });

        const stateData = await stateRes.json();

        if (stateData.data?.session_closed) {
          setClosed(true);
        } else if (stateData.error === 'Message required for continuing session') {
          // Expected — session is open. Load messages from session list.
          // For MVP, we can display the preview and let the user continue.
          setMessages([]);
        }
      } catch {
        // Error loading
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, [session, sessionId]);

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-500">Please sign in.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-gray-500">Loading session...</div>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <p className="text-gray-600 mb-4">This session has ended.</p>
        <button
          onClick={() => router.push(`/app/${slug}/coach`)}
          className="text-blue-600 font-medium"
        >
          Start a new conversation
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-60px)]">
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white">
        <button
          onClick={() => router.push(`/app/${slug}/coach`)}
          className="text-blue-600 font-medium text-sm mr-3"
        >
          Back
        </button>
        <span className="text-sm font-medium text-gray-900">Coach</span>
      </div>
      <div className="h-[calc(100%-52px)]">
        <ChatInterface
          sessionId={sessionId}
          initialMessages={messages}
          onSessionClosed={() => router.push(`/app/${slug}/coach`)}
        />
      </div>
    </div>
  );
}
