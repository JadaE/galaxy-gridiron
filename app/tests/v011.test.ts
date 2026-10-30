// Run: npx tsx --require ./tests/rn-shim.cjs tests/v011.test.ts  (v0.0.11: trade-away chat, per-game ranks, matchup wording, config import)
// All names, teams and ids below are made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Bundle, rankTable, rankSentence, posRank } from '../src/model';
import { rules, tradeIdeasReply } from '../src/chat/engine';
import { namedOnRoster, tradeWords, isEitherOr, splitAsk } from '../src/chat/tradeaway';
import { offersFor } from '../src/trades';
import { resultLine, shortResult } from '../src/live';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const src = (f: string) => fs.readFileSync(__dirname + '/../' + f, 'utf8');

// 1 QB, 1 DEF, QB/DEF not flex-eligible
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'];
type P = [name: string, pos: string, pts: number, fc: number];
const MINE: Record<string, P> = {
  m1: ['Quinn Mockley', 'QB', 21, 6000], m2: ['Rory Fakeson', 'RB', 17, 5000], m3: ['Eli Wilson', 'RB', 8, 900], m4: ['Wes Sampleton', 'WR', 18, 5500],
  m5: ['Ty Placeholder', 'WR', 15, 4000], m6: ['Pat Mockmuth', 'TE', 7, 700], m7: ['Tad Testwell', 'TE', 12, 3800], m8: ['Dan Demoson', 'RB', 11, 2000],
  m9: ['Walt Exampler', 'WR', 10, 1600], m10: ['Bo Backupson', 'QB', 14, 1200], mk: ['Kip Kickerly', 'K', 8, 0], md: ['Mock City Defense', 'DEF', 8, 0],
};
const THEIRS: Record<string, P> = {
  o1: ['Otto Otherman', 'WR', 14, 1650], o2: ['Rex Rivalson', 'RB', 13, 1550], o3: ['Quill Qbington', 'QB', 15, 1600], o4: ['Tom Tightend', 'TE', 9, 800],
  o5: ['Cal Starman', 'WR', 22, 9000], o6: ['Ned Benchley', 'RB', 5, 600],
};
let seq = 0;
function league(mine = MINE, theirs = THEIRS): Bundle {
  const players: any = {}, proj: any = {}, vals: any = {}, fc: any = {}, season_: any = {};
  for (const r of [mine, theirs]) for (const id in r) { const [n, p, v, f] = r[id]; players[id] = { n, p, t: 'TM' }; proj[id] = [v, v, v, 1]; vals[id] = v; if (f) fc[id] = f; season_[id] = [v * 7, v * 7, v * 7, 7]; }
  for (let k = 0; k < 60; k++) proj['x' + k] = [0, 0, 0, 0];
  const me: any = { rid: 1, players: Object.keys(mine), starters: [], reserve: [], display: 'MockTeamA', name: 'Mock A' };
  const them: any = { rid: 2, players: Object.keys(theirs), starters: [], reserve: [], display: 'MockTeamB', name: 'Mock B' };
  const valuer = { get: (id: string) => ({ value: vals[id] || 0, games: vals[id] ? 6 : 0, floor: (vals[id] || 0) * 0.7, median: vals[id] || 0, tier: 'steady', trend: 0, weeks: [] }) };
  return { slots: SLOTS, players, proj, si: 0, me, teams: [me, them], byRid: { 1: me, 2: them }, isPast: false, week: 8, lastScored: 7, trending: [], tx: [], sched: null, valuer, season_,
    league: { league_id: 'mock-league-' + (++seq), name: 'Mock League', settings: {}, roster_positions: [...SLOTS, 'BN', 'BN'], total_rosters: 2 }, loadedAt: 1, fc, practice: {}, games: null, allowed: {} } as any;
}
const roster = (b: Bundle) => b.me.players.map(id => ({ id, name: b.players[id].n, pos: b.players[id].p }));
const Q1 = 'Who should i trade if i trade Pat and Wilson?';
const Q2 = 'I want to trade 2 players on my team:  pat & wilson; who should I ask for in return?';

(async () => {
  console.log('v0.0.11 #3 trade questions about HER players');
  await t('both phrasings name Pat Mockmuth + Eli Wilson on her roster', () => {
    const b = league();
    for (const q of [Q1, Q2]) { assert.ok(tradeWords(q), q); const r = namedOnRoster(q, roster(b)); assert.deepEqual(r.give.sort(), ['m3', 'm6'], q); assert.equal(r.ambiguous, null); }
  });
  await t('two players with the same name -> ask which one', () => {
    const b = league({ ...MINE, m11: ['Russ Wilson', 'WR', 9, 1000] });
    const r = namedOnRoster(Q1, roster(b)); assert.deepEqual(r.give, ['m6']); assert.deepEqual(r.ambiguous?.ids.sort(), ['m11', 'm3']);
  });
  await t('"Pat or Wilson?" is a comparison; "for" splits give from get', () => {
    assert.ok(isEitherOr('trade Pat or Wilson?')); assert.ok(!isEitherOr(Q1)); assert.ok(!isEitherOr('pat & wilson or someone'));
    assert.deepEqual(splitAsk('trade pat for otto').tail.trim(), 'for otto');
  });
  for (const q of [Q1, Q2]) await t(`chat reply to "${q.slice(0, 40)}…" gives exactly Pat + Wilson`, async () => {
    const r: any = await rules.answer(q, { b: league(), tags: {} });
    assert.ok(!r.cards, 'should not show a single player card'); assert.ok(!/already yours/.test(r.text), r.text);
    assert.ok(!/Ask @|Leaving out/.test(r.text), r.text);
    assert.match(r.text, /Trading Pat Mockmuth \+ Eli Wilson: trade value 700 \+ 900 = 1,600/);
    const gives = r.text.split('\n').filter((l: string) => /You give:/.test(l));
    assert.ok(gives.length >= 1, r.text);
    for (const g of gives) assert.equal(g.replace(/^\s*\d+\.\s*/, '').trim(), 'You give: Pat Mockmuth + Eli Wilson');
    assert.match(r.text, /You get: .+ \(from @MockTeamB\)/); assert.match(r.text, /Trade value: 1,600 for [\d,]+ · Your lineup: [+-]/);
    assert.match(r.text, /Trade value = market price/);
  });
  await t('ambiguous name -> "Which one do you mean?" choices', async () => {
    const r: any = await rules.answer(Q1, { b: league({ ...MINE, m11: ['Russ Wilson', 'WR', 9, 1000] }), tags: {} });
    assert.match(r.text, /2 players named Wilson/); assert.deepEqual(r.choices.map((c: any) => c.label).sort(), ['Eli Wilson', 'Russ Wilson']);
    assert.match(r.choices[0].q, /Pat and (Eli|Russ) Wilson/);
  });
  await t('offers are fair, from one team, and never count a backup QB as a starter (1 QB, no QB flex)', () => {
    const b = league();
    const { offers, giveV } = offersFor(b, ['m3', 'm6'], 5);
    assert.equal(giveV, 1600); assert.ok(offers.length > 0);
    for (const o of offers) { assert.deepEqual(o.give, ['m3', 'm6']); assert.ok(o.getV >= 1600 * 0.85 && o.getV <= 1600 * 1.15, String(o.getV)); }
    const qbOnly = offers.find(o => o.get.length === 1 && o.get[0] === 'o3');
    if (qbOnly) assert.ok(qbOnly.net < offers[0].net, 'backup QB ranked first');
    assert.notDeepEqual(offers[0].get, ['o3']);
  });
  await t('"Pat and Wilson for Otto?" only offers deals that get Otto', () => {
    const { offers } = offersFor(league(), ['m3', 'm6'], 3, ['o1']); assert.ok(offers.length > 0); offers.forEach(o => assert.ok(o.get.includes('o1')));
  });
  await t('a named player who is not hers gets a short note, the rest still works', async () => {
    const mine = { ...MINE }; delete mine.m6;
    const r: any = await rules.answer(Q1, { b: league(mine, { ...THEIRS, o7: ['Pat Mockmuth', 'TE', 7, 700] }), tags: {} });
    assert.match(r.text, /Pat Mockmuth isn't on your team \(@MockTeamB has him\), so this is just for Eli Wilson/); assert.match(r.text, /You give: Eli Wilson/);
  });
  await t('"Trade for Otto Otherman?" (not hers) still answers about getting him', async () => {
    const r: any = await rules.answer('Trade for Otto Otherman?', { b: league(), tags: {} });
    assert.equal(r.cards?.[0]?.name, 'Otto Otherman'); assert.ok(!/You give: Pat/.test(r.text));
  });
  await t('general trade ideas use You give / You get and a short 🔒 line', () => {
    const b = league();
    const r = tradeIdeasReply(b, { m1: 'never', m2: 'never' });
    assert.ok(!/Ask @|Leaving out/.test(r.text), r.text);
    if (/You give/.test(r.text)) { assert.match(r.text, /^Not offering your 2 🔒 players\./); assert.match(r.text, /You get: .+ \(from @MockTeamB\)/); }
  });

  console.log('v0.0.11 #1 ranks by points per game and by season total');
  await t('a QB who missed games ranks high per game, low in total', () => {
    const season: any = {}, players: any = {};
    for (let i = 0; i < 20; i++) { players['q' + i] = { p: 'QB' }; season['q' + i] = [150 - i * 5, 0, 0, 7]; }
    players.cw = { p: 'QB' }; season.cw = [76, 0, 0, 4]; // 19 per game, only 4 games
    players.fl = { p: 'QB' }; season.fl = [40, 0, 0, 1]; // 1-game fluke: no per-game rank
    const r = rankTable(season, players, 0, 8);
    assert.equal(r.cw.perGame, 5); assert.ok(r.cw.total! > 15, String(r.cw.total)); assert.equal(r.fl.perGame, null);
    assert.match(rankSentence(r.cw), /^5th among QBs in points per game, \d+(st|nd|rd|th) in total points\. Higher per game because of missed games \(4 played\)\./);
    assert.match(rankSentence(r.fl), /no per-game rank yet \(needs 3\)/);
  });
  await t('player card data carries both ranks', async () => {
    const b = league(); const r = posRank(b, 'm1'); assert.equal(r?.pos, 'QB'); assert.ok(r?.perGame && r?.total);
    assert.match(src('src/screens/PlayerSheet.tsx'), /rankSentence\(rk\)/); assert.match(src('src/screens/Chat.tsx'), /'Rank'/);
  });

  console.log('v0.0.11 #2 matchup wording');
  await t('short result keeps "Leading by" until every game is final', async () => {
    const f = (n: number) => n.toFixed(1);
    const sr = shortResult;
    assert.equal(sr(resultLine(120, 100, false, false, f)), 'Leading by 20.0 · games left');
    assert.ok(!/Won/.test(sr(resultLine(120, 100, false, false, f))));
    assert.equal(sr(resultLine(120, 100, false, true, f)), 'Won by 20.0 🎉');
    assert.equal(sr(resultLine(90, 100, true, false, f)), 'Projected to lose by 10.0');
    assert.match(src('src/screens/Matchup.tsx'), /shortResult\(resultLine\(a, o, useProj, decided, fmt\)\)/);
    assert.ok(!/You have the edge at/.test(src('src/screens/Matchup.tsx')));
  });

  console.log('v0.0.11 #4 config import');
  await t('config.ts imports only the generated config (no try/catch, never config.local)', () => {
    const s = src('src/config.ts').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.match(s, /import generated from '\.\/appconfig\.generated\.json'/);
    assert.ok(!/try\s*\{|catch|require\(|appconfig\.default|config\.local/.test(s), s);
    const pkg = JSON.parse(src('package.json')); assert.match(pkg.scripts.pretest, /gen-appconfig/); assert.match(pkg.scripts.postinstall, /gen-appconfig/);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
