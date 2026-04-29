// Canonical phone-number handling.
// C7/H4/H6: Single source of truth for E.164 normalization used by:
//   - inbound Sinch webhook lookup
//   - outbound Sinch send
//   - opt-out check + insert
//   - CSV import
//   - onboarding form
//   - app-auth phone → user lookup
//
// Any new path that touches `users.phone` MUST call `normalizePhone` from this file.
// Do NOT add local regex normalizers elsewhere. If the format you need isn't handled
// here, extend this file.

export class InvalidPhoneError extends Error {
  constructor(public input: string, public reason: string) {
    super(`invalid phone "${input}": ${reason}`);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Normalize a phone number to strict E.164 ("+" + country code + subscriber digits).
 * Accepts: "+14155551234", "14155551234", "4155551234", "+1 (415) 555-1234", "+44 20 1234 5678"
 * Rejects: non-numeric, too-short, too-long.
 *
 * Assumption: a 10-digit bare number is North American and gets "+1" prefixed.
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new InvalidPhoneError(String(raw), 'empty_or_non_string');
  }
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  // Leading + preserved, rest stripped to digits.
  if (trimmed.startsWith('+')) {
    if (digits.length < 8 || digits.length > 15) {
      throw new InvalidPhoneError(raw, 'e164_length_out_of_range');
    }
    return `+${digits}`;
  }

  // 11 digits starting with 1 → North American with country code.
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // 10 digits → assume North American bare number.
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 8–15 digits without + → international bare number; can't disambiguate; reject.
  throw new InvalidPhoneError(raw, 'ambiguous_no_country_code');
}

/** Soft variant: returns null on invalid input instead of throwing. */
export function tryNormalizePhone(raw: string): string | null {
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

/**
 * Check that a string is already valid E.164. Use in form validators and
 * DB CHECK constraints (the regex here is mirror-able to Postgres).
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}
