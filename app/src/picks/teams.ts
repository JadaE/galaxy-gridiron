// NFL team names, nicknames and abbreviations for matching free-form notes. Pure TS (Node-testable).
// Keys are ESPN abbreviations (what the scoreboard returns).
export type TeamInfo = { abbr: string; city: string; name: string; aliases: string[] };

const T: [string, string, string, string[]][] = [
  ['ARI', 'Arizona', 'Cardinals', ['cards', 'az', 'arz', 'zona', 'red birds', 'redbirds']],
  ['ATL', 'Atlanta', 'Falcons', ['dirty birds', 'atl']],
  ['BAL', 'Baltimore', 'Ravens', ['balt', 'bmore', 'b more']],
  ['BUF', 'Buffalo', 'Bills', ['buff', 'bills mafia']],
  ['CAR', 'Carolina', 'Panthers', ['carolina panthers', 'cats']],
  ['CHI', 'Chicago', 'Bears', ['da bears', 'chi town', 'chitown']],
  ['CIN', 'Cincinnati', 'Bengals', ['cincy', 'cinci', 'bungals', 'bengels']],
  ['CLE', 'Cleveland', 'Browns', ['clev', 'dawg pound']],
  ['DAL', 'Dallas', 'Cowboys', ['boys', 'dal', 'big d', 'americas team', "america's team"]],
  ['DEN', 'Denver', 'Broncos', ['donkeys']],
  ['DET', 'Detroit', 'Lions', ['det']],
  ['GB', 'Green Bay', 'Packers', ['pack', 'gnb', 'greenbay', 'cheeseheads']],
  ['HOU', 'Houston', 'Texans', ['htx']],
  ['IND', 'Indianapolis', 'Colts', ['indy']],
  ['JAX', 'Jacksonville', 'Jaguars', ['jags', 'jac', 'jax', 'duval']],
  ['KC', 'Kansas City', 'Chiefs', ['kcc', 'kan', 'kc chiefs']],
  ['LV', 'Las Vegas', 'Raiders', ['vegas', 'lvr', 'oak', 'oakland', 'raider nation']],
  ['LAC', 'Los Angeles Chargers', 'Chargers', ['bolts', 'la chargers', 'lac', 'sd', 'san diego']],
  ['LAR', 'Los Angeles Rams', 'Rams', ['la rams', 'lar', 'lams']],
  ['MIA', 'Miami', 'Dolphins', ['fins', 'phins', 'mia', 'fish']],
  ['MIN', 'Minnesota', 'Vikings', ['vikes', 'minn', 'skol', 'mn']],
  ['NE', 'New England', 'Patriots', ['pats', 'nwe', 'nep', 'ne pats']],
  ['NO', 'New Orleans', 'Saints', ['nola', 'nos', 'nor', 'who dat']],
  ['NYG', 'New York Giants', 'Giants', ['ny giants', 'nyg', 'gmen', 'g men', 'big blue']],
  ['NYJ', 'New York Jets', 'Jets', ['ny jets', 'nyj', 'gang green']],
  ['PHI', 'Philadelphia', 'Eagles', ['philly', 'birds', 'iggles']],
  ['PIT', 'Pittsburgh', 'Steelers', ['pitt', 'pitts', 'stillers']],
  ['SF', 'San Francisco', '49ers', ['niners', '9ers', 'sf', 'sfo', 'san fran', 'forty niners', 'fortyniners', 'sf 49ers']],
  ['SEA', 'Seattle', 'Seahawks', ['hawks', 'sea', 'seahawk', '12s']],
  ['TB', 'Tampa Bay', 'Buccaneers', ['bucs', 'bucks', 'tampa', 'tb', 'tampa bay bucs', 'buccs']],
  ['TEN', 'Tennessee', 'Titans', ['tenn', 'titan']],
  ['WSH', 'Washington', 'Commanders', ['was', 'wsh', 'wash', 'dc', 'commies', 'commanders', 'skins', 'redskins', 'football team']],
];

export const TEAMS: Record<string, TeamInfo> = {};
for (const [abbr, city, name, al] of T) TEAMS[abbr] = { abbr, city, name, aliases: al };

/** Normalize text for matching: lowercase, strip accents/punctuation except digits/letters/space. */
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// alias -> abbr, longest first. Cities shared by two teams (LA, New York) only match with the nickname.
const ALIAS: [string, string][] = [];
for (const t of Object.values(TEAMS)) {
  const set = new Set<string>([t.abbr.toLowerCase(), norm(t.name), norm(t.city + ' ' + t.name), ...t.aliases.map(norm)]);
  if (!/^(Los Angeles|New York)/.test(t.city)) set.add(norm(t.city));
  if (t.name === 'Raiders') set.add('las vegas raiders').add('oakland raiders');
  set.forEach(a => a && ALIAS.push([a, t.abbr]));
}
// plural-ish forms people type: "chief", "bill", "packer"
for (const t of Object.values(TEAMS)) if (/s$/.test(t.name) && t.name.length > 4) ALIAS.push([norm(t.name.slice(0, -1)), t.abbr]);
ALIAS.sort((a, b) => b[0].length - a[0].length);
// Words that are abbreviations but also everyday words: only count them when written in CAPS in the original.
const RISKY = new Set(['no', 'ne', 'was', 'sea', 'det', 'min', 'ten', 'boys', 'cats', 'fish', 'birds', 'hawks', 'bucks', 'kan', 'dc', 'sd', 'mn', 'oak', 'titan', 'nos', 'nor', 'chief', 'bill', 'giant', 'jet', 'ram', 'lion', 'bear', 'colt', 'saint', 'brown', 'texan', 'viking', 'bengal', 'raven', 'eagle', 'falcon', 'charger', 'packer', 'steeler', 'patriot', 'jaguar', 'dolphin', 'titan', 'cardinal', 'panther', 'bronco', 'cowboy', 'seahawk', 'buccaneer', 'commander']);
const SINGULAR_OK = new Set(['chief', 'bill', 'giant', 'jet', 'ram', 'lion', 'bear', 'colt', 'saint', 'brown', 'texan', 'viking', 'bengal', 'raven', 'eagle', 'falcon', 'charger', 'packer', 'steeler', 'patriot', 'jaguar', 'dolphin', 'cardinal', 'panther', 'bronco', 'cowboy', 'seahawk', 'buccaneer', 'commander']);

export type Mention = { abbr: string; start: number; end: number; text: string };
/** Find team mentions in a line, left to right. Uses word boundaries on the normalized text. */
export function findTeams(line: string): Mention[] {
  const n = ' ' + norm(line) + ' ';
  const used = new Array(n.length).fill(false);
  const out: Mention[] = [];
  const caps = new Set((line.match(/\b[A-Z]{2,3}\b/g) || []).map(x => x.toLowerCase()));
  for (const [a, abbr] of ALIAS) {
    let from = 0;
    for (;;) {
      const i = n.indexOf(' ' + a + ' ', from);
      if (i < 0) break;
      from = i + 1;
      const s = i + 1, e = s + a.length;
      if (used.slice(s, e).some(Boolean)) continue;
      if (RISKY.has(a) && !SINGULAR_OK.has(a) && !caps.has(a)) continue; // "no", "was", "min" in prose
      for (let k = s; k < e; k++) used[k] = true;
      out.push({ abbr, start: s, end: e, text: a });
    }
  }
  out.sort((x, y) => x.start - y.start);
  // "Kansas City Chiefs" may produce one mention; "KC Chiefs" two of the same team adjacent: merge same-team neighbours
  const merged: Mention[] = [];
  for (const m of out) { const p = merged[merged.length - 1]; if (p && p.abbr === m.abbr && m.start - p.end <= 2) { p.end = m.end; continue; } merged.push(m); }
  return merged;
}
/** Normalized line text, for checking words between mentions. */
export const normLine = (line: string) => ' ' + norm(line) + ' ';
