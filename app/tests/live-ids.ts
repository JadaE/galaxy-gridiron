// Live-data tests (public Sleeper API) need real Sleeper ids from the gitignored config.local.json.
// With only config.example.json (placeholders) they are skipped, so a clean clone's `npm test` still passes.
import { CONFIG } from '../src/config';
export const SLP = (CONFIG as any).sleeper as { userId: string; leagues: { mg: string; fs: string; past: string } };
if (!SLP || /^1000000000000000/.test(SLP.userId)) {
  console.log('SKIPPED (live Sleeper test): add real Sleeper ids to app/config.local.json');
  process.exit(0);
}
