// Conversation session state machine
// Build Master: Phase 2C
//
// Multi-exchange flow (3 exchanges per session):
//   pending → active ←→ active (step_index 0→1→2) → grading → completed
//                 ↓                                     ↓
//              abandoned                              error
//
// step_index tracks which exchange we're on (0, 1, 2).
// Session stays 'active' between exchanges.
// Only transitions to 'grading' on the final exchange (step_index === 2).

export type SessionStatus = 'pending' | 'active' | 'grading' | 'completed' | 'abandoned' | 'error';

export const MAX_EXCHANGES = 3;
export const FINAL_STEP_INDEX = MAX_EXCHANGES - 1; // 2

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

/** True if this is the final exchange (should trigger grading). */
export function isFinalExchange(stepIndex: number): boolean {
  return stepIndex >= FINAL_STEP_INDEX;
}
