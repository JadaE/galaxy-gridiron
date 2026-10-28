// Run: npx tsx tests/model.test.ts  (live public Sleeper/FantasyCalc data, read-only)
import { SLP } from './live-ids';
import assert from 'node:assert/strict';
import { loadBundle, val, valueSource, hasProj, projOf, pname } from '../src/model';
import { rosterFit } from '../src/fit';
import { tradeIdeas, MAX_GIVE_USES } from '../src/trades';
import { rules } from '../src/chat/engine';
import { buildContext, CONTEXT_MAX } from '../src/ai/context';
const UID = SLP.userId;
let pass = 0, fail = 0;
const t = (n: string, f: () => void) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
(async () => {
  for (const lid of [SLP.leagues.fs, SLP.leagues.mg]) {
    const b = await loadBundle(lid, UID);
    console.log(b.league.name);
    const ids = b.me.players.filter(id => !b.me.reserve.includes(id));
    t('roster fit sums to 100 and stays 3..97 for every pair on her roster', () => {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const f = rosterFit(b, ids[i], ids[j]); assert.equal(f.a.pct + f.b.pct, 100); assert.ok(f.a.pct >= 3 && f.a.pct <= 97); assert.ok(f.reasons.length >= 1 && f.reasons.length <= 4); }
    });
    t('no projected player is valued at 0 just because the stats feed has no games (Josh Jacobs bug)', () => {
      const all = b.teams.flatMap(x => x.players);
      const bad = all.filter(id => hasProj(b, id) && projOf(b, id) > 1 && val(b, id) <= 0);
      assert.deepEqual(bad.map(id => pname(b, id)), []);
      if (all.includes('5850')) { assert.ok(val(b, '5850') > 0, 'Josh Jacobs value ' + val(b, '5850')); console.log('      Josh Jacobs:', valueSource(b, '5850'), val(b, '5850').toFixed(1)); }
    });
    t('roster fit is symmetric', () => { const f = rosterFit(b, ids[0], ids[1]), g = rosterFit(b, ids[1], ids[0]); assert.ok(Math.abs(f.a.pct - g.b.pct) <= 1); });
    t(`no player in more than ${MAX_GIVE_USES} trade ideas`, () => { const c: Record<string, number> = {}; tradeIdeas(b, {}, 10).ideas.forEach(i => i.give.forEach(g => (c[g] = (c[g] || 0) + 1))); assert.ok(Math.max(0, ...Object.values(c)) <= MAX_GIVE_USES, JSON.stringify(c)); });
    t('🔒 never-tagged players are never offered', () => { const tags: any = {}; ids.slice(0, 6).forEach(id => (tags[id] = 'never')); tradeIdeas(b, tags, 10).ideas.forEach(i => i.give.forEach(g => assert.notEqual(tags[g], 'never'))); });
    t('💎 high-value players only offered for ≥115% of market', () => { const tags: any = {}; ids.forEach(id => (tags[id] = 'high')); tradeIdeas(b, tags, 10).ideas.forEach(i => assert.ok(i.getV >= i.giveV * 1.15 - 1, `${i.getV} vs ${i.giveV}`)); });
    t('AI context under 6 KB', () => { const c = buildContext(b, {}, { mentioned: ids.slice(0, 3) }); assert.ok(JSON.stringify(c).length <= CONTEXT_MAX); });
  }
  const mg = await loadBundle(SLP.leagues.mg, UID);
  const r = await rules.answer('Wilson or Pitts Sr', { b: mg, tags: {} });
  t("rules 'Wilson or Pitts Sr' includes fit %", () => { assert.ok(r.fit); assert.equal(r.fit!.aPct + r.fit!.bPct, 100); assert.match(r.text, /Roster fit: .* \d+% vs .* \d+%/); });
  for (const q of ['Vikings or Texans?', 'Caleb Williams or Bryce Young?']) {
    const w = await rules.answer(q, { b: mg, tags: {} });
    t(`'${q}' is a this-week answer (verdict names the week, matchup lines, no roster-fit bar)`, () => {
      assert.match(w.verdict || '', new RegExp(`^Week ${mg.week}: `)); assert.ok(!w.fit); assert.ok(w.winner); assert.match(w.text, /•/);
      assert.doesNotMatch(w.verdict || '', /fits your roster| he fits/); assert.ok(w.cards!.every(c => c.week && c.week.length));
    });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
