/**
 * Canonical app URL accessor.
 * NEXT_PUBLIC_BASE_URL is the canonical env var.
 * Falls back to NEXT_PUBLIC_APP_URL (legacy alias) then VERCEL_URL.
 */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'https://dealershipiq-wua7.vercel.app'
  );
}
