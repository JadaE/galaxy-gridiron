// Question -> intent + player mentions. Pure TS (unit-tested in tests/chat.test.ts).
import { NameIndex, findMentions, Mention, normalize } from './names';

export type Intent =
  | 'compare' | 'start_one' | 'pickup_one' | 'drop_one' | 'tradefor_one' | 'player'
  | 'lineup' | 'waivers_result' | 'best_pickup' | 'trade_ideas' | 'status' | 'matchup' | 'report' | 'playoffs' | 'help';
export type Action = 'start' | 'pickup' | 'drop' | 'trade' | null;
export type TradeAsk = { noHigh: boolean; noStarters: boolean; noLocked: boolean };
export type Parsed = { intent: Intent; action: Action; mentions: Mention[]; ambiguous: Mention | null; trade?: TradeAsk };

// "without / don't involve / except / keep out ... <thing>"
const NEG = String.raw`(?:without|w\/o|don ?t (?:involve|include|use|touch|give|offer|trade|want)|dont (?:involve|include|use|touch|give|offer|trade|want)|do not (?:involve|include|use|touch)|not (?:involving|including|giving|trading|using)|no|exclude|excluding|except|other than|aside from|besides|leave out|leaving out|keep(?:ing)?|skip|avoid|minus|but not|that aren ?t|not)`;
const near = (what: string) => new RegExp(`${NEG}\\b[^.?!]{0,60}?\\b(?:${what})\\b`);
const HIGH_W = String.raw`high (?:worth|value|valued)|personal high|high-value|diamonds?|gems?|valuable|my best|studs?|keepers?|core|stars?`;
const LOCK_W = String.raw`locked|locks?|lock tagged|will not trade|wont trade|won ?t trade|untouchables?|off limits|off-limits|untradeable|untradable|protected`;
const START_W = String.raw`starters?|starting lineup|my lineup|starting guys|guys i start`;
/** General trade question? ("good trades", "trade ideas", "who should I trade", "any trades I could make") */
export function tradeAsk(q: string, raw: string): TradeAsk | null {
  const t = /\b(trades?|trading|trade ideas?|deals?|trade offers?|trade targets?)\b/.test(q) || /\bwho (should|can|could|do) i (trade|move|sell|deal)\b/.test(q) || /\bwhat (should|can|could) i (trade|offer|sell)\b/.test(q);
  if (!t) return null;
  const both = q + ' ' + raw;
  return {
    noLocked: near(LOCK_W).test(q) || /🔒/.test(raw),
    noHigh: near(HIGH_W).test(q) || /(?:without|no|not|except|exclud|don.?t|keep|avoid|skip|leave)[^.?!]{0,40}💎/iu.test(raw),
    noStarters: near(START_W).test(q) || /\b(only|just) (my )?bench\b|\bbench (guys|players) only\b/.test(both),
  };
}

export function detectAction(q: string): Action {
  if (/\b(pick ?up|add|grab|claim|stash|worth (an )?add|waive?r? for)\b/.test(q)) return 'pickup';
  if (/\b(drop|cut|release|let go)\b/.test(q)) return 'drop';
  if (/\btrade (for|away)|\bacquire\b|\bbuy\b|\bsell\b|trade target/.test(q)) return 'trade';
  if (/\b(start|sit|play|flex|bench|lineup)\b/.test(q)) return 'start';
  return null;
}

export function parse(question: string, idx: NameIndex): Parsed {
  const q = normalize(question);
  const raw = question.toLowerCase();
  const action = detectAction(q);
  // general intents that should not be hijacked by player names
  if (/\b(waiver|waivers|claims?)\b/.test(q) && /\b(go|went|result|results|happen|happened|how did|hit)\b/.test(q)) return { intent: 'waivers_result', action, mentions: [], ambiguous: null };
  if (/\b(report card|grade|graded|how did i do|last week)\b/.test(q)) return { intent: 'report', action, mentions: [], ambiguous: null };
  if (/\b(playoff|playoffs|top 3|top three|make it|path)\b/.test(q)) return { intent: 'playoffs', action, mentions: [], ambiguous: null };
  if (/\bhow am i\b|\bhow are we\b|\bmy record\b|\bstanding|\bwhere do i rank\b/.test(q)) return { intent: 'status', action, mentions: [], ambiguous: null };
  if (/\b(who am i playing|my opponent|opponent|matchup|who do i play)\b/.test(q)) return { intent: 'matchup', action, mentions: [], ambiguous: null };
  const genericOnly = /^(who should i start\??|best pick ?ups?\??|trade ideas\??|who should i pick ?up\??|who should i add\??|any trades\??)$/.test(raw.trim());
  const found = genericOnly ? [] : findMentions(question, idx);
  // X-or-Y and single-player answers need names that are clearly there, not words that fuzzy-match someone
  const mentions = found.filter(m => m.clear);
  const ambiguous = mentions.find(m => m.ambiguous) || null;
  const ta = tradeAsk(q, raw);
  if (ta) {
    if (mentions.length >= 2) return { intent: 'compare', action: action || 'trade', mentions: mentions.slice(0, 2), ambiguous, trade: ta };
    if (mentions.length === 1 && !ta.noHigh && !ta.noStarters) return { intent: 'tradefor_one', action: 'trade', mentions, ambiguous, trade: ta };
    return { intent: 'trade_ideas', action: 'trade', mentions: [], ambiguous: null, trade: ta };
  }
  if (mentions.length >= 2) return { intent: 'compare', action, mentions: mentions.slice(0, 2), ambiguous };
  if (mentions.length === 1) {
    const intent: Intent = action === 'pickup' ? 'pickup_one' : action === 'drop' ? 'drop_one' : action === 'trade' ? 'tradefor_one' : action === 'start' ? 'start_one' : 'player';
    return { intent, action, mentions, ambiguous };
  }
  if (action === 'start') return { intent: 'lineup', action, mentions, ambiguous: null };
  if (action === 'pickup' || /\b(waiver|free agent|pick ?ups?)\b/.test(q)) return { intent: 'best_pickup', action, mentions, ambiguous: null };
  if (/\btrade/.test(q)) return { intent: 'trade_ideas', action, mentions, ambiguous: null, trade: { noHigh: false, noStarters: false, noLocked: false } };
  return { intent: 'help', action, mentions, ambiguous: null };
}
