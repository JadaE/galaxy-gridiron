// Run: npx tsx tests/junk.test.ts  (v0.0.5: junk players + trade-question routing; real Sleeper data, read-only)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slimPlayers } from '../src/api';
import { rawJunkReason } from '../src/junk';
import { loadBundle, isRelevant, pname } from '../src/model';
import { parse, tradeAsk } from '../src/chat/intents';
import { normalize } from '../src/chat/names';
import { rules } from '../src/chat/engine';
import { tradeIdeas } from '../src/trades';
import { pickups } from '../src/pickups';
const UID = (process.env.GG_USER_ID || '1000000000000000001');
const HER = "What's some good trades that don't involve high worth or locked players?";
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

(async () => {
  const raw = JSON.parse(fs.readFileSync(process.env.GG_PLAYERS_JSON || __dirname + '/../../data/players_nfl.json', 'utf8'));
  const slim = slimPlayers(raw);
  console.log('raw data');
  await t('"Duplicate Player" entries are all dropped', () => {
    const dups = Object.keys(raw).filter(id => /duplicate/i.test(`${raw[id].first_name} ${raw[id].last_name} ${raw[id].full_name || ''}`));
    assert.ok(dups.length > 0, 'fixture should contain Duplicate Player rows');
    for (const id of dups) assert.ok(!slim[id], `kept ${id} ${raw[id].full_name}`);
  });
  await t('retired short-id players (Tim Hightower id 83) are dropped', () => { assert.ok(!slim['83']); assert.ok(rawJunkReason('83', raw['83'])); });
  await t('team defenses stay (all 32)', () => assert.equal(Object.values(slim).filter(p => p.p === 'DEF').length, 32));
  await t('junk rule catches synthetic placeholders', () => {
    for (const p of [{ first_name: 'Duplicate', last_name: 'Player', fantasy_positions: ['WR'], team: 'CHI', status: 'Inactive', active: false },
      { first_name: 'Test', last_name: 'Player', fantasy_positions: ['RB'], team: 'NYJ', status: 'Active', active: true },
      { first_name: 'Player', last_name: '12', fantasy_positions: ['TE'], team: 'DAL', active: true },
      { first_name: '', last_name: '', fantasy_positions: ['QB'], team: 'KC', active: true },
      { first_name: 'Joe', last_name: 'Nobody', fantasy_positions: ['QB'], status: 'Inactive', active: true }])
      assert.ok(rawJunkReason('999999', p), JSON.stringify(p));
    assert.equal(rawJunkReason('4046', raw['4046']), null, 'Mahomes kept');
  });

  console.log('trade phrasing (intent only)');
  const fakeIdx: any = { resolve: () => [] };
  const V: [string, Partial<{ noHigh: boolean; noStarters: boolean; noLocked: boolean }>][] = [
    [HER, { noHigh: true, noLocked: true }],
    ['good trades?', {}], ['any trade ideas', {}], ['who should I trade', {}], ['who should i trade away this week', {}],
    ['what are the best trades I could make', {}], ['give me some trade ideas without my starters', { noStarters: true }],
    ["trades that don't involve my locked guys", { noLocked: true }], ['trade ideas without high value players', { noHigh: true }],
    ['any good deals excluding my 💎 players', { noHigh: true }], ['suggest trades but keep my starters and untouchables', { noStarters: true, noLocked: true }],
    ['who can I trade without giving up my studs', { noHigh: true }],
  ];
  for (const [q, want] of V) await t(`"${q}" -> trade_ideas ${JSON.stringify(want)}`, () => {
    const p = parse(q, fakeIdx); assert.equal(p.intent, 'trade_ideas');
    for (const k of ['noHigh', 'noStarters', 'noLocked'] as const) assert.equal(!!p.trade?.[k], !!want[k], k);
  });
  await t('"start Pitts or Wilson" is not a trade question', () => assert.equal(tradeAsk(normalize('start Pitts or Wilson'), 'start Pitts or Wilson'), null));

  const liveLeagues = [process.env.GG_LEAGUE_MG, process.env.GG_LEAGUE_FS].filter(Boolean) as string[];
  if (!process.env.GG_USER_ID || !liveLeagues.length) console.log('SKIP live-league checks: set GG_USER_ID and GG_LEAGUE_MG / GG_LEAGUE_FS to run them.');
  for (const lid of (process.env.GG_USER_ID ? liveLeagues : [])) {
    const b = await loadBundle(lid, UID);
    console.log(b.league.name);
    const mine = b.me.players;
    const tags: any = {}; mine.slice(0, 2).forEach(id => (tags[id] = 'never')); mine.slice(2, 5).forEach(id => (tags[id] = 'high'));
    await t('her exact sentence returns trade ideas, not a comparison', async () => {
      const r: any = await rules.answer(HER, { b, tags });
      assert.ok(!r.fit, 'got a comparison: ' + r.text); assert.ok(/Ask @|couldn.t find/.test(r.text), r.text);
      assert.ok(!/Hightower|Duplicate/i.test(r.text), r.text);
      if (/Ask @/.test(r.text)) assert.ok(/Leaving out 🔒/.test(r.text), r.text);
    });
    await t('ideas for her sentence never give a 🔒 or 💎 player', () => {
      tradeIdeas(b, tags, 10, { noHigh: true }).ideas.forEach(i => i.give.forEach(g => assert.ok(!tags[g], pname(b, g))));
    });
    await t('"without my starters" never gives a starter', () => {
      const st = new Set((b.me.starters || []).filter(Boolean));
      tradeIdeas(b, {}, 10, { noStarters: true }).ideas.forEach(i => i.give.forEach(g => assert.ok(!st.has(g), pname(b, g))));
    });
    await t('no junk/irrelevant player anywhere in bundle, pickups or trade targets', () => {
      for (const id in b.players) assert.ok(!/duplicate|placeholder/i.test(b.players[id].n), b.players[id].n);
      pickups(b).forEach((x: any) => assert.ok(isRelevant(b, x.id ?? x.add ?? x), JSON.stringify(x).slice(0, 80)));
      tradeIdeas(b, {}, 10).ideas.forEach(i => i.get.forEach(g => assert.ok(b.players[g])));
    });
    for (const q of ['Duplicate Player or Hightower?', 'high or players', 'should i start locked or high worth']) await t(`junk words "${q}" never produce a compare card`, async () => {
      const r: any = await rules.answer(q, { b, tags: {} }); assert.ok(!r.fit, r.text); assert.ok(!/Hightower|Duplicate/i.test(r.text || ''), r.text);
    });
    await t('real two-player compare still works', async () => {
      const ids = mine.filter(id => b.players[id]?.p === 'WR').slice(0, 2);
      if (ids.length < 2) return;
      const r: any = await rules.answer(`${pname(b, ids[0])} or ${pname(b, ids[1])}`, { b, tags: {} }); assert.equal(r.cards?.length, 2, r.text); assert.ok(r.winner || r.fit, r.text);
    });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
