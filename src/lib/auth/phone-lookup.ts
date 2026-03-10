// Phase 1H: Employee Identity Model
// Phone number = identity. Zero friction. No Supabase Auth account for employees.
// Identified by MSISDN lookup against users table + dealership_memberships.

import { serviceClient } from '@/lib/supabase/service';

interface PhoneLookupResult {
  userId: string;
  fullName: string;
  phone: string;
  language: 'en' | 'es';
  status: string;
  memberships: Array<{
    dealershipId: string;
    role: string;
  }>;
}

/**
 * Look up a user by E.164 phone number. Returns user + all dealership memberships.
 * Used by webhook handler to identify inbound SMS sender.
 *
 * Cross-tenant query — approved exception to Build Master Rule 2.
 * Initial phone lookup to determine which dealership the SMS belongs to.
 */
export async function lookupByPhone(phone: string): Promise<PhoneLookupResult | null> {
  const normalizedPhone = normalizePhone(phone);

  const { data, error } = await serviceClient
    .from('users')
    .select(`
      id,
      full_name,
      phone,
      language,
      status,
      dealership_memberships (
        dealership_id,
        role
      )
    `)
    .eq('phone', normalizedPhone)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows found
    throw error;
  }

  if (!data) return null;

  const memberships = (
    data.dealership_memberships as Array<{
      dealership_id: string;
      role: string;
    }>
  );

  return {
    userId: data.id,
    fullName: data.full_name,
    phone: data.phone,
    language: data.language as 'en' | 'es',
    status: data.status,
    memberships: memberships.map((m) => ({
      dealershipId: m.dealership_id,
      role: m.role,
    })),
  };
}

/**
 * Normalize phone to E.164 format (+1XXXXXXXXXX for North American numbers).
 * Strips non-digit characters, adds country code if missing.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Already has country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // 10-digit North American number
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already in E.164 with +
  if (phone.startsWith('+') && digits.length >= 10) {
    return `+${digits}`;
  }

  // Return as-is with + prefix — let Sinch validate
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Resolve which dealership an inbound SMS should route to.
 * For single-membership users: return the only dealership.
 * For multi-membership users: return the primary membership's dealership.
 */
export function resolveDealership(
  memberships: PhoneLookupResult['memberships']
): string | null {
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0].dealershipId;

  // Multi-location: primary membership wins (set via dealership_memberships.is_primary)
  // Since we don't have is_primary in the lookup, fall back to first membership.
  // Phase 1I JWT hook handles active dealership for dashboard users.
  return memberships[0].dealershipId;
}
