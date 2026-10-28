// Live-data tests (public Sleeper API) need real Sleeper ids from the gitignored app/config.local.json.
// Read here with Node fs (like tools/an/ids.ts), never through the app's CONFIG, so they can't end up in a bundle.
// Without the file, or with only placeholders, they are skipped, so a clean clone's `npm test` still passes.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
const LOCAL = join(__dirname, '../config.local.json');
export const SLP = (existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')).sleeper : undefined) as
  { userId: string; leagues: { mg: string; fs: string; past: string } };
if (!SLP || !SLP.userId || /^1000000000000000/.test(SLP.userId)) {
  console.log('SKIPPED (live Sleeper test): add real Sleeper ids to app/config.local.json');
  process.exit(0);
}
