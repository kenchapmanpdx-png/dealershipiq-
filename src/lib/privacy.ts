// Privacy helpers for rendering user identity in public / low-auth contexts.
//
// 2026-04-18 H-7: The public leaderboard (/api/leaderboard/[slug],
// /leaderboard/[slug]) is reachable without authentication — it's intended
// for TV displays on the dealership floor. Prior to this change it returned
// every rep's FULL NAME to anyone on the internet who knew (or guessed) the
// slug. That's PII-over-exposure, especially once you combine "dealership X
// employs Jane Smith" with other public data. We now default to
// "First L." on any public surface and require an explicit opt-in for full
// names — which can be reintroduced later behind a per-dealership feature
// flag if a site wants the TV display to show more.

/**
 * Convert a full name to a privacy-preserving public display form.
 *
 * Examples:
 *   "Jane Smith"          -> "Jane S."
 *   "Jane Mary Smith"     -> "Jane S."   (uses first + last token)
 *   "Cher"                -> "Cher"      (single token, no surname to mask)
 *   "  spaced  name  "    -> "spaced n."
 *   "" / null / undefined -> "Rep"       (safe fallback)
 */
export function publicDisplayName(fullName: string | null | undefined): string {
  if (!fullName) return 'Rep';

  const trimmed = String(fullName).trim();
  if (trimmed.length === 0) return 'Rep';

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    // Single-word name — nothing to abbreviate.
    return tokens[0];
  }

  const first = tokens[0];
  const lastInitial = tokens[tokens.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}
