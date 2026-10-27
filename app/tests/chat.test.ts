// Run: npx tsx tests/chat.test.ts  (uses real Sleeper player data + a real account's rosters)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NameIndex, normalize, lev } from '../src/chat/names';
import { parse } from '../src/chat/intents';

const all = JSON.parse(fs.readFileSync('/workspace/fantasy-football/data/players_nfl.json', 'utf8'));
import { slimPlayers } from '../src/api';
const players: Record<string, any> = slimPlayers(all); // same filter the app uses (v0.0.5 junk rules)
const proj: Record<string, number> = JSON.parse(fs.readFileSync(__dirname + '/fixture_proj_w7.json', 'utf8'));
const MG = JSON.parse(fs.readFileSync(__dirname + '/fixture_rosters_mg.json', 'utf8'));
const FS = JSON.parse(fs.readFileSync(__dirname + '/fixture_rosters_fs.json', 'utf8'));
const UID = '1000000000000000007';
function indexFor(rosters: any[]) {
  const mine = new Set<string>(rosters.find(r => r.owner_id === UID).players);
  const rostered = new Set<string>(rosters.flatMap(r => r.players || []));
  const rel = (id: string) => (mine.has(id) ? 12 : 0) + (rostered.has(id) ? 6 : 0) + (proj[id] ? Math.min(6, 2 + proj[id] / 4) : 0) + (players[id]?.t ? 0 : -10);
  return new NameIndex(players, rel);
}
const mg = indexFor(MG), fs_ = indexFor(FS);
const nameOf = (id: string | null) => (id ? players[id]?.n : null);

let pass = 0, fail = 0;
function t(name: string, fn: () => void) { try { fn(); pass++; console.log('  ✓', name); } catch (e: any) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
const best = (idx: NameIndex, q: string) => parse(q, idx).mentions.map(m => nameOf(m.best));

console.log('normalize / distance');
t('suffix + punctuation', () => assert.equal(normalize("Kyle Pitts Sr."), 'kyle pitts sr'));
t('apostrophes & hyphens', () => assert.equal(normalize("Ja'Marr Chase / Smith-Njigba"), 'jamarr chase smith njigba'));
t('levenshtein', () => { assert.equal(lev('mccaffery', 'mccaffrey'), 1); assert.equal(lev('pits', 'pitts'), 1); });

console.log('parser: Moments Gang context');
t("'Wilson or Pitts Sr' -> compare Emanuel Wilson (hers) vs Kyle Pitts", () => {
  const p = parse('Wilson or Pitts Sr', mg); assert.equal(p.intent, 'compare'); assert.deepEqual(best(mg, 'Wilson or Pitts Sr'), ['Emanuel Wilson', 'Kyle Pitts']);
});
t("'should I pick up pitts' -> pickup_one Kyle Pitts", () => { const p = parse('should I pick up pitts', mg); assert.equal(p.intent, 'pickup_one'); assert.equal(nameOf(p.mentions[0].best), 'Kyle Pitts'); });
t("'pitts?' -> player Kyle Pitts", () => { const p = parse('pitts?', mg); assert.equal(p.intent, 'player'); assert.equal(nameOf(p.mentions[0].best), 'Kyle Pitts'); });
t("'Kyle Pitts vs Tre Tucker' -> compare", () => { const p = parse('Kyle Pitts vs Tre Tucker', mg); assert.equal(p.intent, 'compare'); assert.deepEqual(best(mg, 'Kyle Pitts vs Tre Tucker'), ['Kyle Pitts', 'Tre Tucker']); });
t("misspelling 'start Skatebo or Cook?'", () => assert.deepEqual(best(mg, 'start Skatebo or Cook?'), ['Cam Skattebo', 'James Cook']));
t("misspelling 'mccaffery or bijan'", () => assert.deepEqual(best(mg, 'mccaffery or bijan'), ['Christian McCaffrey', 'Bijan Robinson']));
t("misspelling 'jaxon smith-njigba vs jsn' style: 'smith njigba'", () => assert.equal(best(mg, 'is smith njigba good')[0], 'Jaxon Smith-Njigba'));
t("'should i start trey mcbride' -> start_one", () => { const p = parse('should i start trey mcbride', mg); assert.equal(p.intent, 'start_one'); assert.equal(nameOf(p.mentions[0].best), 'Trey McBride'); });
t("'drop Freiermuth?' -> drop_one", () => { const p = parse('drop Freiermuth?', mg); assert.equal(p.intent, 'drop_one'); assert.equal(nameOf(p.mentions[0].best), 'Pat Freiermuth'); });
t("'trade for Puka' -> tradefor_one", () => { const p = parse('should I trade for Puka', mg); assert.equal(p.intent, 'tradefor_one'); assert.equal(nameOf(p.mentions[0].best), 'Puka Nacua'); });
t("first name only, unique: 'Skattebo or Saquon'", () => assert.deepEqual(best(mg, 'Skattebo or Saquon'), ['Cam Skattebo', 'Saquon Barkley']));
t("defense: 'vikings or texans d'", () => assert.deepEqual(best(mg, 'vikings or texans d'), ['Minnesota Vikings', 'Houston Texans']));
t("'Mason or Jacobs' -> Jordan Mason & Josh Jacobs (hers)", () => assert.deepEqual(best(mg, 'Mason or Jacobs'), ['Jordan Mason', 'Josh Jacobs']));
t("ambiguous 'Brown' flags disambiguation", () => { const p = parse('should I pick up Brown', mg); assert.ok(p.ambiguous, 'expected ambiguous'); assert.ok(p.ambiguous!.cands.length >= 2); });
t("'Josh Allen' resolves to the QB", () => { const p = parse('josh allen?', mg); assert.equal(players[p.mentions[0].best!].p, 'QB'); });
t("partial last name 'freier' -> Freiermuth", () => assert.equal(best(mg, 'freier?')[0], 'Pat Freiermuth'));
t("generic intents untouched", () => {
  assert.equal(parse('Who should I start?', mg).intent, 'lineup');
  assert.equal(parse('Best pickup?', mg).intent, 'best_pickup');
  assert.equal(parse('How did my waivers go?', mg).intent, 'waivers_result');
  assert.equal(parse('Trade ideas', mg).intent, 'trade_ideas');
  assert.equal(parse('How am I doing?', mg).intent, 'status');
  assert.equal(parse('Who am I playing?', mg).intent, 'matchup');
  assert.equal(parse('any trade ideas for me', mg).intent, 'trade_ideas');
});
console.log('parser: Fam Slam context');
t("'Wilson or Pitts Sr' in Fam Slam (Michael Wilson dropped 10/21) -> most relevant Wilson or a 'did you mean' prompt", () => {
  const p = parse('Wilson or Pitts Sr', fs_);
  assert.equal(nameOf(p.mentions[1].best), 'Kyle Pitts');
  const w = p.mentions[0];
  assert.ok(w.ambiguous || nameOf(w.best) === 'Garrett Wilson', 'got ' + nameOf(w.best));
});
t("'Tucker' in Fam Slam (not hers) still finds Tre Tucker", () => assert.equal(best(fs_, 'tucker?')[0], 'Tre Tucker'));
t("'Gibbs or Achane'", () => assert.deepEqual(best(fs_, 'Gibbs or Achane'), ["Jahmyr Gibbs", "De'Von Achane"]));
t("typo 'jusitn jefferson'", () => assert.equal(best(fs_, 'jusitn jefferson')[0], 'Justin Jefferson'));
t("typo 'Pits vs Likely'", () => assert.deepEqual(best(fs_, 'Pits vs Likely'), ['Kyle Pitts', 'Isaiah Likely']));
t("'AJ Brown or London' -> A.J. Brown, Drake London", () => assert.deepEqual(best(fs_, 'AJ Brown or London'), ['A.J. Brown', 'Drake London']));
t("'Burrow vs Maye'", () => assert.deepEqual(best(fs_, 'Burrow vs Maye'), ['Joe Burrow', 'Drake Maye']));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
