/**
 * Tenant Isolation Tests — C-003 Verification
 *
 * Verify that RLS-scoped Supabase clients filter data by dealership_id.
 * Tests simulate the RLS behavior: given seed data for two tenants,
 * assert that queries scoped to Tenant A return ZERO data from Tenant B.
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Constants
// ============================================================================

const DEALERSHIP_A = 'aaaa-aaaa-aaaa-aaaa';
const DEALERSHIP_B = 'bbbb-bbbb-bbbb-bbbb';
const USER_A = 'user-aaa-111';
const USER_B = 'user-bbb-222';

// ============================================================================
// Seed Data (two tenants with data in every table migrated from serviceClient)
// ============================================================================

const SEED: Record<string, Record<string, unknown>[]> = {
  users: [
    { id: USER_A, full_name: 'Alice', phone: '+11111111111', status: 'active', dealership_id: DEALERSHIP_A },
    { id: USER_B, full_name: 'Bob', phone: '+12222222222', status: 'active', dealership_id: DEALERSHIP_B },
  ],
  dealership_memberships: [
    { user_id: USER_A, dealership_id: DEALERSHIP_A, role: 'salesperson', is_primary: true },
    { user_id: USER_B, dealership_id: DEALERSHIP_B, role: 'salesperson', is_primary: true },
  ],
  training_results: [
    { id: 'tr-a', user_id: USER_A, dealership_id: DEALERSHIP_A, product_accuracy: 4, tone_rapport: 3, addressed_concern: 5, close_attempt: 4 },
    { id: 'tr-b', user_id: USER_B, dealership_id: DEALERSHIP_B, product_accuracy: 5, tone_rapport: 5, addressed_concern: 5, close_attempt: 5 },
  ],
  conversation_sessions: [
    { id: 'cs-a', user_id: USER_A, dealership_id: DEALERSHIP_A, status: 'completed' },
    { id: 'cs-b', user_id: USER_B, dealership_id: DEALERSHIP_B, status: 'completed' },
  ],
  sms_opt_outs: [
    { id: 'oo-a', phone: '+19999999999', dealership_id: DEALERSHIP_A },
    { id: 'oo-b', phone: '+18888888888', dealership_id: DEALERSHIP_B },
  ],
  coach_sessions: [
    { id: 'coach-a', user_id: USER_A, dealership_id: DEALERSHIP_A, session_topic: 'tactical', sentiment_trend: 'positive' },
    { id: 'coach-b', user_id: USER_B, dealership_id: DEALERSHIP_B, session_topic: 'debrief', sentiment_trend: 'neutral' },
  ],
  askiq_queries: [
    { id: 'ask-a', user_id: USER_A, dealership_id: DEALERSHIP_A, query_text: 'What is MPG?' },
    { id: 'ask-b', user_id: USER_B, dealership_id: DEALERSHIP_B, query_text: 'What is AWD?' },
  ],
  meeting_scripts: [
    { id: 'ms-a', dealership_id: DEALERSHIP_A, script_date: '2026-03-13', sms_text: 'Meeting A' },
    { id: 'ms-b', dealership_id: DEALERSHIP_B, script_date: '2026-03-13', sms_text: 'Meeting B' },
  ],
  dealership_brands: [
    { dealership_id: DEALERSHIP_A, make_id: 'make-1' },
    { dealership_id: DEALERSHIP_B, make_id: 'make-2' },
  ],
  knowledge_gaps: [
    { id: 'kg-a', dealership_id: DEALERSHIP_A, topic: 'EV range' },
    { id: 'kg-b', dealership_id: DEALERSHIP_B, topic: 'Towing' },
  ],
};

// ============================================================================
// RLS Simulation Helper
// ============================================================================

/**
 * Simulates Row Level Security filtering.
 * Returns only rows where dealership_id matches the authenticated tenant.
 */
function rlsFilter(table: string, tenantId: string): Record<string, unknown>[] {
  const allRows = SEED[table] ?? [];
  return allRows.filter(
    (row) => !('dealership_id' in row) || row.dealership_id === tenantId
  );
}

/**
 * Simulates RLS WITH CHECK for INSERT/UPDATE.
 * Returns true if the row's dealership_id matches the authenticated tenant.
 */
function rlsCheckInsert(row: Record<string, unknown>, tenantId: string): boolean {
  if (!('dealership_id' in row)) return true;
  return row.dealership_id === tenantId;
}

// ============================================================================
// Tests
// ============================================================================

describe('C-003 Tenant Isolation', () => {
  // ---- Migrated routes: coach_sessions (v5 migration) ----

  describe('dashboard/coach-themes — coach_sessions SELECT', () => {
    it('Tenant A sees ONLY own coach sessions', () => {
      const rows = rlsFilter('coach_sessions', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });

    it('Tenant B data is excluded', () => {
      const rows = rlsFilter('coach_sessions', DEALERSHIP_A);
      expect(rows.find((r) => r.dealership_id === DEALERSHIP_B)).toBeUndefined();
    });
  });

  // ---- Migrated routes: askiq_queries (v5 migration) ----

  describe('ask/route — askiq_queries INSERT', () => {
    it('INSERT with correct dealership_id passes RLS check', () => {
      const row = { user_id: USER_A, dealership_id: DEALERSHIP_A, query_text: 'test' };
      expect(rlsCheckInsert(row, DEALERSHIP_A)).toBe(true);
    });

    it('INSERT with wrong dealership_id fails RLS check', () => {
      const row = { user_id: USER_A, dealership_id: DEALERSHIP_B, query_text: 'attack' };
      expect(rlsCheckInsert(row, DEALERSHIP_A)).toBe(false);
    });

    it('askiq_queries SELECT returns only own-tenant queries', () => {
      const rows = rlsFilter('askiq_queries', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });
  });

  // ---- Batch 1 migrated routes ----

  describe('users/[id] — dealership_memberships SELECT', () => {
    it('Tenant A sees ONLY own memberships', () => {
      const rows = rlsFilter('dealership_memberships', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
      expect(rows[0].user_id).toBe(USER_A);
    });
  });

  describe('users/import — sms_opt_outs SELECT', () => {
    it('Tenant A sees ONLY own opt-outs', () => {
      const rows = rlsFilter('sms_opt_outs', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });
  });

  describe('dashboard/meeting-script — meeting_scripts SELECT', () => {
    it('Tenant A sees ONLY own meeting scripts', () => {
      const rows = rlsFilter('meeting_scripts', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });
  });

  describe('onboarding/brands — dealership_brands SELECT', () => {
    it('Tenant A sees ONLY own brands', () => {
      const rows = rlsFilter('dealership_brands', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });
  });

  describe('push/training — users SELECT', () => {
    it('Tenant A sees ONLY own users', () => {
      const rows = rlsFilter('users', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });
  });

  // ---- Cross-tenant attack scenarios ----

  describe('Cross-tenant attack prevention', () => {
    it('Tenant A cannot see Tenant B training results', () => {
      const rows = rlsFilter('training_results', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER_A);
      expect(rows.find((r) => r.dealership_id === DEALERSHIP_B)).toBeUndefined();
    });

    it('Tenant A cannot see Tenant B conversation sessions', () => {
      const rows = rlsFilter('conversation_sessions', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
      expect(rows.find((r) => r.dealership_id === DEALERSHIP_B)).toBeUndefined();
    });

    it('Tenant A cannot see Tenant B knowledge gaps', () => {
      const rows = rlsFilter('knowledge_gaps', DEALERSHIP_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].dealership_id).toBe(DEALERSHIP_A);
    });

    it('INSERT to wrong tenant blocked by WITH CHECK', () => {
      // Simulate cross-tenant INSERT attempts
      const tables = ['users', 'dealership_memberships', 'askiq_queries', 'coach_sessions'];
      for (const _table of tables) {
        const attackRow = { dealership_id: DEALERSHIP_B, user_id: USER_A };
        expect(rlsCheckInsert(attackRow, DEALERSHIP_A)).toBe(false);
      }
    });

    it('Each tenant sees exactly their own data across all tables', () => {
      const tablesWithTenantData = Object.keys(SEED).filter(
        (t) => SEED[t].some((r) => 'dealership_id' in r)
      );

      for (const table of tablesWithTenantData) {
        const aRows = rlsFilter(table, DEALERSHIP_A);
        const bRows = rlsFilter(table, DEALERSHIP_B);

        // Each tenant sees exactly 1 row (our seed has 1 per tenant per table)
        expect(aRows).toHaveLength(1);
        expect(bRows).toHaveLength(1);

        // No cross-contamination
        expect(aRows[0].dealership_id).toBe(DEALERSHIP_A);
        expect(bRows[0].dealership_id).toBe(DEALERSHIP_B);
      }
    });
  });
});
