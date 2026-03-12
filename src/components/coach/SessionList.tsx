// Coach Mode session list — recent sessions + new conversation button
// Phase 4.5A

'use client';

interface SessionSummary {
  id: string;
  session_topic: string | null;
  door_selected: string | null;
  created_at: string;
  ended_at: string | null;
  preview: string;
  message_count: number;
}

interface SessionListProps {
  sessions: SessionSummary[];
  onSelectSession: (sessionId: string) => void;
  onNewConversation: () => void;
}

const TOPIC_LABELS: Record<string, string> = {
  tactical: 'Skill Coaching',
  debrief: 'Debrief',
  career: 'Career Path',
  emotional: 'Work Stress',
  compensation: 'Compensation',
  conflict: 'Conflict',
};

export default function SessionList({
  sessions,
  onSelectSession,
  onNewConversation,
}: SessionListProps) {
  const recent = sessions.slice(0, 3);

  return (
    <div className="px-4 py-6">
      <button
        onClick={onNewConversation}
        className="w-full bg-blue-600 text-white font-medium py-3 rounded-xl hover:bg-blue-700 transition mb-6"
      >
        New conversation
      </button>

      {recent.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-500 mb-3">Recent</h3>
          <div className="space-y-2">
            {recent.map((session) => (
              <button
                key={session.id}
                onClick={() => !session.ended_at && onSelectSession(session.id)}
                disabled={!!session.ended_at}
                className={`w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 transition ${
                  session.ended_at
                    ? 'opacity-60 cursor-default'
                    : 'hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium text-gray-900">
                    {TOPIC_LABELS[session.session_topic ?? session.door_selected ?? ''] ?? 'Coaching'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatRelativeDate(session.created_at)}
                  </span>
                </div>
                {session.preview && (
                  <p className="text-xs text-gray-500 line-clamp-2">
                    {session.preview}
                  </p>
                )}
                {session.ended_at && (
                  <span className="text-[10px] text-gray-400 mt-1 inline-block">Ended</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffHours < 48) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
