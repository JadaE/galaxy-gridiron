// v0.0.15 (JC-34): the shared leaderboard is unlocked and read/written only through the AI Worker. Mock data only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/v015.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import { VERSION_CODE, VERSION_NAME } from '../src/version';
let pass = 0, fail = 0;
const t = (n: string, f: () => any) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
console.log('v0.0.15 server-side leaderboard');
t('version is 0.0.15 (15) and app.json matches', () => {
  assert.equal(VERSION_CODE, 15); assert.equal(VERSION_NAME, '0.0.15');
  const a = JSON.parse(fs.readFileSync(__dirname + '/../app.json', 'utf8')).expo;
  assert.equal(a.version, '0.0.15'); assert.equal(a.android.versionCode, 15);
});
t('no app source derives collection names or talks to Site Data for picks', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(d + '/' + e.name) : /\.tsx?$/.test(e.name) ? [d + '/' + e.name] : []));
  const files = walk(__dirname + '/../src').concat(__dirname + '/../App.tsx');
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!s.includes('galaxy-gridiron/leaderboard/v1'), f + ' has the old salt');
    assert.ok(!/deriveFamilyKey|probeFamilyKey|lb_family'\)\.then/.test(s), f + ' uses the old password oracle');
  }
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
