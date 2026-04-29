/**
 * Canonical app URL accessor.
 * NEXT_PUBLIC_BASE_URL is the canonical env var.
 * Falls back to NEXT_PUBLIC_APP_URL (legacy alias) then VERCEL_URL.
 *
 * S11: no hardcoded preview URL. If none of the above are set we THROW at
 * call time so a misconfigured deploy fails loudly instead of emitting links
 * pointing at a stale preview domain that could be claimed by anyone.
 */
export function getAppUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (!url) {
    throw new Error(
      'getAppUrl: no base URL configured. Set NEXT_PUBLIC_BASE_URL (preferred) or NEXT_PUBLIC_APP_URL in Vercel project settings.'
    );
  }
  return url;
}
