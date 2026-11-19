// JC-58: Sleeper username entry. Lookup is the public username only (not display name). No search of other users.
/** Trim surrounding whitespace and at most one leading @. */
export function normalizeSleeperUsername(raw: string): string {
  const s = raw.trim();
  return (s.startsWith('@') ? s.slice(1) : s).trim();
}

/** Shown when the public Sleeper username lookup finds no account (not for network errors).
 * Location is from Sleeper Support, "Account Settings" (https://support.sleeper.com/en/articles/1876011-account-settings):
 * mobile: profile icon in the bottom-left corner, where you can edit your username. */
export function sleeperUsernameHint(raw = ''): string {
  const name = normalizeSleeperUsername(raw);
  const lead = name ? `No Sleeper user named "${name}". ` : '';
  return lead + 'Use your Sleeper username, not your display name. In the Sleeper app, tap your profile icon in the bottom-left corner to find it.';
}

export function isSleeperUserNotFound(err: unknown): boolean {
  const m = String((err as any)?.message ?? err ?? '');
  return /No Sleeper user named/.test(m) || /HTTP 404/.test(m);
}
