// Run: npx tsx tests/news.test.ts  (v0.0.6 player news: fixtures captured 2026-10-21 from Sleeper's public news feed)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classify, plain, recent, seasonFromNews, diffSnap, cluster } from '../src/news';
let pass = 0, fail = 0;
const t = (n: string, f: () => void) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const load = (pid: string) => JSON.parse(fs.readFileSync(`${__dirname}/fixtures/news-${pid}.json`, 'utf8')).data.get_player_news.map((x: any) => ({ ts: x.published, src: x.source, title: x.metadata.title, desc: x.metadata.description || '', topic: x.metadata.topic_id }));
const NOW = Date.parse('2026-10-21T20:00:00Z');
const maye = load('11564'), jj = load('6794'), jacobs = load('5850');

t('classify: ruled out / IR / activated are major injuries', () => { for (const s of ['Justin Jefferson - Ruled out for Week 4', 'X placed on injured reserve', 'Comes off exempt list', 'Activated from IR']) assert.equal(classify(s, '', 'rotowire'), 'injuryMajor', s); });
t('classify: trade / release / suspension / role', () => {
  assert.equal(classify('Traded to Steelers', '', 'rotowire'), 'team'); assert.equal(classify('Released by Jets', '', 'rotowire'), 'team');
  assert.equal(classify('Suspended two games', '', 'rotowire'), 'suspension'); assert.equal(classify('Named starter for Week 8', '', 'rotowire'), 'role');
});
t('classify: speculation headlines are opinion, not news', () => { for (const s of ['Drake Maye Worth Benching Amid Nightmare Start to Season', 'Is Drake Maye\'s Confidence Gone?', 'Josh Jacobs Is Too Risky for Anything More Than a Late-Round Pick']) assert.equal(classify(s, '', 'rotoballer'), 'opinion', s); });
t('plain strips "Name - " and the name prefix', () => { assert.equal(plain('Drake Maye - Three more TD tosses in win', 'Drake Maye'), 'Three more TD tosses in win'); assert.equal(plain("Drake Maye's Ceiling Even Higher", 'Drake Maye'), 'His Ceiling Even Higher'); });
t('recent: 2-4 lines, newest first, repeats merged', () => {
  for (const [items, name] of [[maye, 'Drake Maye'], [jj, 'Justin Jefferson'], [jacobs, 'Josh Jacobs']] as const) {
    const r = recent(items, name, NOW); assert.ok(r.length >= 2 && r.length <= 4, name + ' ' + r.length);
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].ts! >= r[i].ts!);
    assert.ok(r.every(l => /via (Sleeper|ESPN)/.test(l.src)));
  }
  const r = recent(maye, 'Drake Maye', NOW); assert.equal(r[0].text, 'Three more TD tosses in win'); assert.ok((r[0].more || 0) >= 2, 'three sources merged');
});
t('cluster merges 40 Maye items into far fewer events', () => { const c = cluster(maye, 'Drake Maye'); assert.ok(c.length < maye.length * 0.6, `${c.length}/${maye.length}`); });
t('season: Jefferson ankle (ruled out Wk 4) is there; game recaps are not', () => {
  const s = seasonFromNews(jj, 'Justin Jefferson', Date.parse('2026-08-15'));
  assert.ok(s.some(l => /Ruled out for Week 4/.test(l.text)), JSON.stringify(s.map(l => l.text)));
  assert.ok(!s.some(l => l.kind === 'game' || l.kind === 'opinion'));
});
t('season: Jacobs exempt list on and off', () => { const s = seasonFromNews(jacobs, 'Josh Jacobs', Date.parse('2026-08-15')).map(l => l.text).join(' | '); assert.ok(/Lands on Commissioner's Exempt List/.test(s) && /off exempt list/i.test(s), s); });
t('season: Maye has no fake major events', () => { const s = seasonFromNews(maye, 'Drake Maye', Date.parse('2026-08-15')); assert.ok(s.every(l => l.kind !== 'opinion'), JSON.stringify(s)); });
t('snapshot diff: injury, team, depth chart changes', () => {
  const prev: any = { '1': ['NE', '', 2], '2': ['NYJ', 'Questionable', 1], '3': ['DAL', '', 1] };
  const players: any = { '1': { n: 'A', p: 'WR', t: 'NE', d: 1 }, '2': { n: 'B', p: 'RB', t: 'NYJ', i: 'IR', d: 1 }, '3': { n: 'C', p: 'TE', t: 'PIT', d: 1 }, '4': { n: 'D', p: 'QB', t: 'KC' } };
  const { snap, ev } = diffSnap(prev, players, 1, () => true);
  assert.equal(Object.keys(snap).length, 4);
  assert.deepEqual(ev.map(e => e.kind).sort(), ['injuryMajor', 'role', 'team']);
  assert.ok(ev.find(e => e.id === '2')!.text.includes('Questionable → IR'));
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
