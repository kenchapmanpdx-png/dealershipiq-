// Coaching queue page — flagged sessions needing manager attention
// Client component — shows low-score and perfect-score sessions
// Build Master: Phase 3

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface CoachingSession {
  id: string;
  user_id: string;
  user_name: string;
  mode: string;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  reason: 'low_score' | 'perfect_score';
  created_at: string;
}

interface CoachingData {
  queue: CoachingSession[];
}

export default function CoachingPage() {
  const [data, setData] = useState<CoachingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingEncouragement, setSendingEncouragement] = useState<string | null>(null);
  const [encouragementMessage, setEncouragementMessage] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/coaching-queue');
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch coaching queue:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();

    // Poll every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const sendEncouragement = async (userId: string) => {
    setSendingEncouragement(userId);
    try {
      const res = await fetch(`/api/users/${userId}/encourage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: encouragementMessage || undefined }),
      });

      if (res.ok) {
        setEncouragementMessage('');
        setSelectedSessionId(null);
        // Refresh the coaching queue
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to send encouragement:', err);
    } finally {
      setSendingEncouragement(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse">Loading coaching queue...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>Failed to load coaching queue</p>
      </div>
    );
  }

  const lowScoreSessions = data.queue.filter((s) => s.reason === 'low_score');
  const perfectScoreSessions = data.queue.filter((s) => s.reason === 'perfect_score');

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Coaching Queue</h1>

      {/* Low score sessions */}
      {lowScoreSessions.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 bg-red-100 text-red-700 rounded-full text-sm font-bold">
              {lowScoreSessions.length}
            </span>
            Needs Support (Low Scores)
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {lowScoreSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={selectedSessionId === session.id}
                onSelectChange={() =>
                  setSelectedSessionId(
                    selectedSessionId === session.id ? null : session.id
                  )
                }
                onSendEncouragement={() => sendEncouragement(session.user_id)}
                sending={sendingEncouragement === session.user_id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Perfect score sessions */}
      {perfectScoreSessions.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 bg-green-100 text-green-700 rounded-full text-sm font-bold">
              {perfectScoreSessions.length}
            </span>
            Celebrate (Perfect Scores)
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {perfectScoreSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={selectedSessionId === session.id}
                onSelectChange={() =>
                  setSelectedSessionId(
                    selectedSessionId === session.id ? null : session.id
                  )
                }
                onSendEncouragement={() => sendEncouragement(session.user_id)}
                sending={sendingEncouragement === session.user_id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {lowScoreSessions.length === 0 && perfectScoreSessions.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-600">No flagged sessions at this time</p>
        </div>
      )}

      {/* M-010: Encouragement modal — accessible dialog */}
      {selectedSessionId && (
        <EncouragementModal
          encouragementMessage={encouragementMessage}
          setEncouragementMessage={setEncouragementMessage}
          onClose={() => setSelectedSessionId(null)}
          onSend={() => {
            const session = data.queue.find((s) => s.id === selectedSessionId);
            if (session) sendEncouragement(session.user_id);
          }}
          sending={sendingEncouragement !== null}
        />
      )}
    </div>
  );
}

// M-010: Accessible modal with focus trap, Escape close, aria attributes
function EncouragementModal({
  encouragementMessage,
  setEncouragementMessage,
  onClose,
  onSend,
  sending,
}: {
  encouragementMessage: string;
  setEncouragementMessage: (v: string) => void;
  onClose: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    // Store previously focused element for return focus
    previousFocusRef.current = document.activeElement;

    // Focus the dialog on mount
    dialogRef.current?.focus();

    // Escape key handler
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap: Tab and Shift+Tab cycle within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Return focus to previously focused element
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encouragement-modal-title"
      ref={dialogRef}
      tabIndex={-1}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3
          id="encouragement-modal-title"
          className="text-lg font-semibold text-gray-900 mb-4"
        >
          Send Encouragement
        </h3>
        <textarea
          value={encouragementMessage}
          onChange={(e) => setEncouragementMessage(e.target.value)}
          placeholder="Type a message (optional - default used if blank)"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-4"
          rows={4}
          maxLength={160}
          aria-label="Encouragement message"
        />
        <div className="text-xs text-gray-500 mb-4" aria-live="polite">
          {encouragementMessage.length}/160 characters
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSend}
            disabled={sending}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SessionCardProps {
  session: CoachingSession;
  isSelected: boolean;
  onSelectChange: () => void;
  onSendEncouragement: () => void;
  sending: boolean;
}

function SessionCard({
  session,
  isSelected: _isSelected,
  onSelectChange: _onSelectChange,
  onSendEncouragement,
  sending,
}: SessionCardProps) {
  const _avg = Math.round(
    (session.product_accuracy +
      session.tone_rapport +
      session.addressed_concern +
      session.close_attempt) /
      4
  );

  const badgeColor =
    session.reason === 'low_score'
      ? 'bg-red-100 text-red-800'
      : 'bg-green-100 text-green-800';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {session.user_name}
          </h3>
          <p className="text-sm text-gray-600">
            {formatDate(session.created_at)} · {session.mode} mode
          </p>
        </div>
        <span className={`px-2 py-1 rounded text-sm font-medium ${badgeColor}`}>
          {session.reason === 'low_score' ? 'Low Score' : 'Perfect!'}
        </span>
      </div>

      {/* Scores grid */}
      <div className="grid grid-cols-4 gap-4 mb-4 p-4 bg-gray-50 rounded">
        <div>
          <div className="text-xs text-gray-600">Accuracy</div>
          <div className="text-2xl font-bold text-gray-900">
            {session.product_accuracy}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-600">Rapport</div>
          <div className="text-2xl font-bold text-gray-900">
            {session.tone_rapport}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-600">Concern</div>
          <div className="text-2xl font-bold text-gray-900">
            {session.addressed_concern}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-600">Close</div>
          <div className="text-2xl font-bold text-gray-900">
            {session.close_attempt}
          </div>
        </div>
      </div>

      {/* Feedback */}
      {session.feedback && (
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <p className="text-sm text-gray-700">{session.feedback}</p>
        </div>
      )}

      {/* Action button */}
      <button
        onClick={onSendEncouragement}
        disabled={sending}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {sending ? 'Sending...' : 'Send Encouragement'}
      </button>
    </div>
  );
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
