// Mock Supabase clients for tenant isolation testing.
// Pattern: Create a mock that tracks all queries and their filters,
// so tests can assert that RLS-equivalent filtering is happening.

import { vi } from 'vitest';

export interface MockQueryLog {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  filters: Record<string, unknown>;
  data?: unknown;
}

/**
 * Creates a chainable Supabase query builder mock.
 * Tracks all operations in `queryLog` for assertion.
 * Returns `mockData` when query resolves.
 */
export function createMockQueryBuilder(
  queryLog: MockQueryLog[],
  mockData: unknown = [],
  mockError: unknown = null
) {
  const builder: Record<string, unknown> = {};
  let currentEntry: Partial<MockQueryLog> = {};

  const chainable = new Proxy(builder, {
    get(_target, prop: string) {
      // Terminal methods — resolve the query
      if (prop === 'then') {
        return undefined; // Not a thenable
      }

      if (['single', 'maybeSingle'] .includes(prop)) {
        return () => {
          queryLog.push(currentEntry as MockQueryLog);
          const result = Array.isArray(mockData) ? mockData[0] ?? null : mockData;
          return Promise.resolve({ data: result, error: mockError });
        };
      }

      // Filter methods
      if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'].includes(prop)) {
        return (column: string, value: unknown) => {
          currentEntry.filters = { ...currentEntry.filters, [column]: value };
          return chainable;
        };
      }

      // Data methods
      if (prop === 'select') {
        return (columns?: string) => {
          currentEntry.operation = 'select';
          if (columns) {
            currentEntry.filters = { ...currentEntry.filters, _select: columns };
          }
          return chainable;
        };
      }

      if (prop === 'insert') {
        return (data: unknown) => {
          currentEntry.operation = 'insert';
          currentEntry.data = data;
          return chainable;
        };
      }

      if (prop === 'update') {
        return (data: unknown) => {
          currentEntry.operation = 'update';
          currentEntry.data = data;
          return chainable;
        };
      }

      if (prop === 'upsert') {
        return (data: unknown) => {
          currentEntry.operation = 'upsert';
          currentEntry.data = data;
          return chainable;
        };
      }

      if (prop === 'delete') {
        return () => {
          currentEntry.operation = 'delete';
          return chainable;
        };
      }

      // Passthrough methods (order, limit, etc.)
      if (['order', 'limit', 'range', 'count'].includes(prop)) {
        return () => chainable;
      }

      // Default: resolve
      return () => {
        queryLog.push(currentEntry as MockQueryLog);
        return Promise.resolve({ data: mockData, error: mockError });
      };
    },
  });

  return chainable;
}

/**
 * Creates a mock Supabase client that simulates RLS behavior.
 * `tenantId` is the dealership_id the "authenticated user" belongs to.
 * All returned data is filtered to only include rows matching tenantId.
 */
export function createMockSupabaseClient(opts: {
  tenantId: string;
  userId: string;
  role: string;
  queryLog: MockQueryLog[];
  tableData: Record<string, unknown[]>;
}) {
  const { tenantId, userId, role, queryLog, tableData } = opts;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
            app_metadata: {
              dealership_id: tenantId,
              user_role: role,
            },
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
    from: (table: string) => {
      // Simulate RLS: only return rows matching tenantId
      const allRows = (tableData[table] ?? []) as Record<string, unknown>[];
      const tenantRows = allRows.filter(
        (row) => row.dealership_id === tenantId || !('dealership_id' in row)
      );

      const entry: Partial<MockQueryLog> = { table, filters: {} };
      queryLog.push(entry as MockQueryLog);

      return createMockQueryBuilder(queryLog, tenantRows);
    },
  };
}

/**
 * Seed data generator for two-tenant test scenarios.
 */
export function createTwoTenantSeed() {
  const DEALERSHIP_A = 'dealership-aaa-111';
  const DEALERSHIP_B = 'dealership-bbb-222';
  const USER_A1 = 'user-a1';
  const USER_A2 = 'user-a2';
  const USER_B1 = 'user-b1';

  return {
    DEALERSHIP_A,
    DEALERSHIP_B,
    USER_A1,
    USER_A2,
    USER_B1,
    users: [
      { id: USER_A1, full_name: 'Alice A', phone: '+11111111111', status: 'active', dealership_id: DEALERSHIP_A },
      { id: USER_A2, full_name: 'Bob A', phone: '+12222222222', status: 'active', dealership_id: DEALERSHIP_A },
      { id: USER_B1, full_name: 'Charlie B', phone: '+13333333333', status: 'active', dealership_id: DEALERSHIP_B },
    ],
    memberships: [
      { user_id: USER_A1, dealership_id: DEALERSHIP_A, role: 'salesperson' },
      { user_id: USER_A2, dealership_id: DEALERSHIP_A, role: 'salesperson' },
      { user_id: USER_B1, dealership_id: DEALERSHIP_B, role: 'salesperson' },
    ],
    training_results: [
      { id: 'tr-a1', user_id: USER_A1, dealership_id: DEALERSHIP_A, product_accuracy: 4, tone_rapport: 3, addressed_concern: 5, close_attempt: 4, training_domain: 'objection_handling', created_at: new Date().toISOString() },
      { id: 'tr-a2', user_id: USER_A2, dealership_id: DEALERSHIP_A, product_accuracy: 3, tone_rapport: 4, addressed_concern: 3, close_attempt: 2, training_domain: 'product_knowledge', created_at: new Date().toISOString() },
      { id: 'tr-b1', user_id: USER_B1, dealership_id: DEALERSHIP_B, product_accuracy: 5, tone_rapport: 5, addressed_concern: 5, close_attempt: 5, training_domain: 'closing_technique', created_at: new Date().toISOString() },
    ],
    conversation_sessions: [
      { id: 'cs-a1', user_id: USER_A1, dealership_id: DEALERSHIP_A, status: 'completed', created_at: new Date().toISOString() },
      { id: 'cs-b1', user_id: USER_B1, dealership_id: DEALERSHIP_B, status: 'completed', created_at: new Date().toISOString() },
    ],
  };
}
