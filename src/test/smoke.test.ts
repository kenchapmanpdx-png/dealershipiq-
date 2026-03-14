import { describe, it, expect } from 'vitest';
import { createTwoTenantSeed } from './supabase-mock';

describe('vitest smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('creates two-tenant seed data', () => {
    const seed = createTwoTenantSeed();
    expect(seed.DEALERSHIP_A).not.toBe(seed.DEALERSHIP_B);
    expect(seed.users.filter((u) => u.dealership_id === seed.DEALERSHIP_A)).toHaveLength(2);
    expect(seed.users.filter((u) => u.dealership_id === seed.DEALERSHIP_B)).toHaveLength(1);
  });
});
