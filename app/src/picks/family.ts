// v0.0.12: the shared (family) picks leaderboard is unlocked by one shared password that people get from the app owner.
// The password never leaves the device and is never stored: the app keeps only the collection names derived from it
// with a one-way hash. Nothing in the app or on the website leads to those names without the password.
// tools/family-collections.sh computes the same names on the box (from $GG_LEADERBOARD_PASSWORD) for the manifest + migration.
import { sha256Hex } from './sha256';

export const FAMILY_SALT = 'galaxy-gridiron/leaderboard/v1';
export type FamilyKey = { live: string; archive: string };
/** live = open picks collection (public insert); archive = owner-written copy of the pre-v0.0.12 picks (read only). */
export function deriveFamilyKey(password: string): FamilyKey {
  const h = sha256Hex(FAMILY_SALT + '\n' + password.trim());
  const live = 'gg' + h.slice(0, 40);
  return { live, archive: live + '_a' };
}
export function validKey(k: any): k is FamilyKey {
  return !!k && typeof k.live === 'string' && /^gg[0-9a-f]{40}$/.test(k.live) && k.archive === k.live + '_a';
}
