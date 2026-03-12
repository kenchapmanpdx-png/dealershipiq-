// Coach Mode main page — Three Doors entry + session list + active conversation
// Phase 4.5A

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRepSession } from '../layout';
import ThreeDoors from '@/components/coach/ThreeDoors';
import SessionList from '@/components/coach/SessionList';
import ChatInterface from '@/components/coach/ChatInterface';
import type { CoachDoor, CoachMessage } from '@/types/coach';

interface SessionSummary {
  id: string;
  session_topic: string | null;
  door_selected: string | null;
  created_at: string;
  ended_at: string | null;
  preview: string;
  message_count: number;
}

type View = 'loading' | 'doors' | 'sessions' | 'chat';

export default function CoachPage() {
  const session = useRepSession();
  const [view, setView] = useState<View>('loading');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<CoachMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/coach/session', {
        headers: { 'x-diq-session': session.token },
      });
      const data = await res.json();
      const list = data.data?.sessions ?? [];
      setSessions(list);

      // Determine initial view
      if (list.length === 0) {
        setView('doors');
      } else {
        setView('sessions');
      }
    } catch {
      setError('Failed to load sessions');
      setView('doors');
    }
  }, [session]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleSelectDoor = async (door: CoachDoor) => {
    if (!session) return;
    setView('loading');

    try {
      const res = await fetch('/api/coach/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-diq-session': session.token,
        },
        body: JSON.stringify({ door }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setView('doors');
        return;
      }

      setActiveSessionId(data.data.session_id);
      setActiveMessages(data.data.messages);
      setView('chat');
    } catch {
      setError('Failed to start session');
      setView('doors');
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (!session) return;
    setView('loading');

    // Load session messages
    try {
      const res = await fetch(`/api/coach/session?session_id=${sessionId}`, {
        headers: { 'x-diq-session': session.token },
      });
      const data = await res.json();

      // Find the session in our list to get its messages
      const existing = sessions.find((s) => s.id === sessionId);
      if (!existing) {
        setView('sessions');
        return;
      }

      // For continuing, we need to POST without a message to check session state
      const stateRes = await fetch('/api/coach/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-diq-session': session.token,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const stateData = await stateRes.json();

      if (stateData.data?.session_closed) {
        // Session was auto-closed
        loadSessions();
        return;
      }

      // We need full message history — get it from a separate load
      // For now, start the chat view with what we have
      setActiveSessionId(sessionId);
      // Load full session messages from the session list data
      // This is a simplified approach — the API stores messages in JSONB
      setActiveMessages(data.data?.messages ?? []);
      setView('chat');
    } catch {
      setView('sessions');
    }
  };

  const handleSessionClosed = () => {
    setActiveSessionId(null);
    setActiveMessages([]);
    loadSessions();
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-500">Please sign in to access Coach Mode.</p>
      </div>
    );
  }

  // Compute tenure description
  const tenureDescription = getTenureDescription(session);

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => { setError(null); loadSessions(); }}
          className="text-blue-600 font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  if (view === 'chat' && activeSessionId) {
    return (
      <div className="h-[calc(100vh-60px)]">
        <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white">
          <button
            onClick={() => { setActiveSessionId(null); loadSessions(); }}
            className="text-blue-600 font-medium text-sm mr-3"
          >
            Back
          </button>
          <span className="text-sm font-medium text-gray-900">Coach</span>
        </div>
        <div className="h-[calc(100%-52px)]">
          <ChatInterface
            sessionId={activeSessionId}
            initialMessages={activeMessages}
            token={session.token}
            onSessionClosed={handleSessionClosed}
          />
        </div>
      </div>
    );
  }

  if (view === 'sessions') {
    return (
      <SessionList
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onNewConversation={() => setView('doors')}
      />
    );
  }

  // Default: Three Doors
  return (
    <ThreeDoors
      firstName={session.firstName}
      tenureDescription={tenureDescription}
      dealershipName="your dealership"
      onSelectDoor={handleSelectDoor}
      showConfidentiality={sessions.length === 0}
    />
  );
}

function getTenureDescription(_session: { userId: string }): string {
  // Simplified — real implementation would fetch from API
  return 'A few weeks';
}
