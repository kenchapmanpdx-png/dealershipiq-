// Conversation session state machine
// Build Master: Phase 2C
// States: pending → active → grading → completed
//                    ↓          ↓
//                abandoned    error

export type SessionStatus = 'pending' | 'active' | 'grading' | 'completed' | 'abandoned' | 'error';

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending: ['active', 'abandoned', 'error'],
  active: ['grading', 'abandoned', 'error'],
  grading: ['completed', 'error', 'abandoned'],
  completed: [], // terminal
  abandoned: [], // terminal
  error: ['abandoned'], // orphaned session detector can clean up
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}
