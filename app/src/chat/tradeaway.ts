// v0.0.11: "Who should I ask for if I trade Pat and Wilson?" Pure TS (unit-tested in tests/v011.test.ts).
// Finds the players SHE named on her own roster, so a trade question about her guys is never answered with one
// player's card ("already yours") or with deals that give away other players.
import { normalize, stripSuffix, lev } from './names';

export type RosterP = { id: string; name: string; pos: string };
export type GiveAsk = { give: string[]; ambiguous: { word: string; ids: string[] } | null };

// everyday words that are also some players' first/last names: never match one of these on its own
export const NOT_A_NAME = new Set(['will', 'love', 'mark', 'hunter', 'king', 'young', 'good', 'best', 'rich', 'bell', 'case', 'trade', 'give', 'team', 'return', 'players', 'player', 'deal', 'offer', 'ask', 'want', 'who', 'what', 'for', 'and', 'my', 'the', 'should', 'would', 'could', 'get']);

/** Does the question ask about trading players away / what to get back? */
export function tradeWords(question: string): boolean {
  const q = normalize(question);
  return /\b(trade|trades|trading|traded|give|giving|give up|offer|offering|in return|in exchange|swap|package|ship)\b/.test(q) || /\bwhat (can|could|would) i get for\b/.test(q) || /\bfor (who|whom|what|someone|anyone|somebody)\b/.test(q);
}

/** Her roster players named in the question. Full names win; a single first or last name counts when exactly one of
 * her players has it (otherwise `ambiguous` lists them so the chat can ask which one). */
export function namedOnRoster(question: string, roster: RosterP[]): GiveAsk {
  const q = ' ' + normalize(question.replace(/[&+]/g, ' and ')) + ' ';
  const words = q.trim().split(' ');
  const give: string[] = [];
  const used = new Set<string>(); // words already explained by a full-name match
  const ents = roster.filter(p => !['DEF', 'K'].includes(p.pos)).map(p => {
    const toks = stripSuffix(normalize(p.name).split(' '));
    return { id: p.id, toks, first: toks[0] || '', last: toks.slice(1).join(' ') || toks[0] || '', lastJoined: toks.slice(1).join('') };
  });
  for (const e of ents) {
    if (e.toks.length >= 2 && q.includes(' ' + e.toks.join(' ') + ' ')) { give.push(e.id); e.toks.forEach(t => used.add(t)); }
  }
  let ambiguous: GiveAsk['ambiguous'] = null;
  for (const w of words) {
    if (w.length < 3 || NOT_A_NAME.has(w) || used.has(w)) continue;
    let hits = ents.filter(e => e.first === w || e.last === w || e.lastJoined === w || e.toks.slice(1).includes(w));
    if (!hits.length && w.length >= 6) hits = ents.filter(e => e.last.length >= 6 && lev(w, e.last, 1) <= 1);
    if (!hits.length) continue;
    if (hits.some(e => give.includes(e.id))) continue;
    if (hits.length === 1) { give.push(hits[0].id); used.add(w); continue; }
    if (!ambiguous) ambiguous = { word: w, ids: hits.map(e => e.id) };
  }
  return { give, ambiguous };
}

/** "Pat or Wilson?" with nothing joining them is a comparison, not a package. */
export const isEitherOr = (question: string) => /\bor\b/.test(normalize(question)) && !/\b(and|both|together|plus)\b|[&+]/.test(question.toLowerCase());

/** Split at the first "for / in return / in exchange": names before it are what she gives, names after it are what she wants. */
export function splitAsk(question: string): { head: string; tail: string } {
  const q = normalize(question.replace(/[&+]/g, ' and '));
  const m = q.match(/\b(for|in return|in exchange)\b/);
  return m && m.index != null ? { head: q.slice(0, m.index), tail: q.slice(m.index) } : { head: q, tail: '' };
}
