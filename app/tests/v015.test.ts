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
t('JC-34 send-back: config.example.json has no YOUR-* leaderboard URL (defaults to "")', () => {
  const ex = JSON.parse(fs.readFileSync(__dirname + '/../config.example.json', 'utf8'));
  assert.equal(ex.leaderboardApi, '');
  assert.equal(JSON.parse(fs.readFileSync(__dirname + '/../src/appconfig.default.json', 'utf8')).leaderboardApi, '');
});
t('JC-34 send-back: gen-appconfig.sh turns YOUR-* placeholders (and non-https) into "" and keeps a real https host', () => {
  const { execFileSync } = require('child_process'); const os = require('os'), path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-genapp-'));
  try {
    fs.mkdirSync(root + '/tools'); fs.mkdirSync(root + '/app/src', { recursive: true });
    fs.copyFileSync(__dirname + '/../../tools/gen-appconfig.sh', root + '/tools/gen-appconfig.sh');
    fs.copyFileSync(__dirname + '/../config.example.json', root + '/app/config.example.json');
    fs.copyFileSync(__dirname + '/../src/appconfig.default.json', root + '/app/src/appconfig.default.json');
    const run = (api: string) => {
      fs.writeFileSync(root + '/app/config.local.json', JSON.stringify({ siteSlug: 'mock-site-0000', publicUpdatePath: 'store', feedbackEnabled: false, leaderboardApi: api }));
      execFileSync('bash', [root + '/tools/gen-appconfig.sh'], { stdio: 'pipe' });
      return JSON.parse(fs.readFileSync(root + '/app/src/appconfig.generated.json', 'utf8')).leaderboardApi;
    };
    for (const bad of ['https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev', 'https://your-worker.mock.workers.dev', 'https://YOUR_WORKER.workers.dev', 'http://mock.example', 'https://mock.example/path', ''])
      assert.equal(run(bad), '', bad);
    assert.equal(run('https://gg-mock.mock-sub.workers.dev'), 'https://gg-mock.mock-sub.workers.dev');
    fs.unlinkSync(root + '/app/config.local.json');
    execFileSync('bash', [root + '/tools/gen-appconfig.sh'], { stdio: 'pipe' });
    assert.equal(JSON.parse(fs.readFileSync(root + '/app/src/appconfig.generated.json', 'utf8')).leaderboardApi, '', 'example fallback');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
t('JC-34 send-back: the app never treats a YOUR-* placeholder as a configured leaderboard', () => {
  const { setLbApi, lbConfigured } = require('../src/picks/sync');
  setLbApi('https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev'); assert.equal(lbConfigured(), false);
  setLbApi('https://gg-mock.mock-sub.workers.dev'); assert.equal(lbConfigured(), true);
  setLbApi('');
});
t('JC-34 send-back: the unlock card comment no longer says the password never leaves the phone', () => {
  const s = fs.readFileSync(__dirname + '/../src/screens/Picks.tsx', 'utf8');
  assert.ok(!/never saved or sent anywhere/.test(s)); assert.ok(/\/lb\/unlock/.test(s));
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
