// v0.0.12: store version. Run: npx tsx --require ./tests/rn-shim.cjs tests/v012.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import { sha256Hex } from '../src/picks/sha256';
import * as family from '../src/picks/family';
import * as sync from '../src/picks/sync';
import { lineSegments, runningPctPoints } from '../src/graphpts';
import { sideNotes } from '../src/matchupnote';
import { titleSize } from '../src/theme';
import { CONFIG } from '../src/config';
import { UPDATE_URL } from '../src/update';
let pass = 0, fail = 0;
const t = (n: string, f: () => any) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

console.log('Family password (server-side since JC-34)');
t('sha256 matches the standard test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  assert.equal(sha256Hex('héllo ✓ 🏈'), require('crypto').createHash('sha256').update('héllo ✓ 🏈').digest('hex'));
});
t('JC-34: the app no longer derives or probes collection names (no salt, no oracle); only server tokens', () => {
  for (const m of [family, sync] as any[]) for (const k of ['FAMILY_SALT', 'deriveFamilyKey', 'probeFamilyKey', 'validKey', 'setFamilyKey']) assert.equal(m[k], undefined, k);
  const src = ['family.ts', 'sync.ts', 'restore.ts'].map(f => fs.readFileSync(__dirname + '/../src/picks/' + f, 'utf8')).join('\n');
  assert.ok(!src.includes('galaxy-gridiron/leaderboard/v1'), 'salt gone'); assert.ok(!src.includes('/.herenow/data/'), 'no direct Site Data');
  assert.ok(family.validToken('lb_' + 'x'.repeat(43))); assert.ok(!family.validToken('gg' + '0'.repeat(40)));
});

console.log('Store config');
t('no private update channel or picks collection is bundled; feedback is off', () => {
  assert.deepEqual(Object.keys(CONFIG).sort(), ['feedbackCollection', 'feedbackEnabled', 'leaderboardApi', 'publicUpdatePath', 'siteSlug']);
  assert.equal(CONFIG.feedbackEnabled, false);
  assert.ok(UPDATE_URL.endsWith('/' + CONFIG.publicUpdatePath + '/version.json'));
  const gen = JSON.parse(fs.readFileSync(__dirname + '/../src/appconfig.generated.json', 'utf8'));
  assert.equal(gen.feedbackCollection, '', 'feedback collection is not bundled while feedback is off');
  assert.ok(!('updateChannelPath' in gen) && !('picksCollection' in gen));
});

console.log('Running win % graph');
t('weeks without picks get no point (no carried-forward line)', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map(w => ({ week: w, rec: [1, 7, 8].includes(w) ? { w: 1, l: 0 } : { w: 0, l: 0 }, cumPct: 1 }));
  assert.deepEqual(runningPctPoints(rows, [1, 2, 3, 4, 5, 6, 7, 8]), [1, null, null, null, null, null, 1, 1]);
});
t('skipped weeks are bridged by a dashed (gap) segment, never a solid one', () => {
  assert.deepEqual(lineSegments([1, null, null, null, null, null, 1, 1]), [{ from: 0, to: 6, gap: true }, { from: 6, to: 7, gap: false }]);
  assert.deepEqual(lineSegments([null, 0.5]), []);
  assert.deepEqual(lineSegments([0.5, 0.6, 0.7]).map(s => s.gap), [false, false]);
});

console.log('Matchup');
t('"still to play" goes under the side that has players left, both when both do', () => {
  assert.deepEqual(sideNotes(0, 3, true, false), { me: '', opp: '3 players still to play' });
  assert.deepEqual(sideNotes(2, 0, true, false), { me: '2 players still to play', opp: '' });
  assert.deepEqual(sideNotes(1, 4, true, false), { me: '1 player still to play', opp: '4 players still to play' });
  assert.deepEqual(sideNotes(3, 3, false, false), { me: '', opp: '' });
  assert.deepEqual(sideNotes(0, 0, true, true), { me: '', opp: '' });
});

console.log('Team header');
t('title steps down on narrow screens', () => {
  assert.ok(titleSize(340) < titleSize(390) && titleSize(390) < titleSize(430) && titleSize(430) < 26);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
