// The ONE place app code reads deployment-specific values (site slug, update channel, collections).
// Real values live in app/config.local.json (gitignored). A clean clone falls back to config.example.json
// (placeholders), so tests and type-checks run, but such a build cannot reach the real site.
export type AppConfig = {
  siteSlug: string;
  updateChannelPath: string;
  picksCollection: string;
  feedbackCollection: string;
  sleeper?: { username: string; userId: string; leagues: { mg: string; fs: string; past: string } }; // tools/tests only
};
declare const require: (id: string) => any;
let cfg: AppConfig;
try { cfg = require('../config.local.json'); } catch { cfg = require('../config.example.json'); }
export const CONFIG: AppConfig = cfg;
export const SITE_SLUG = cfg.siteSlug;
export const SITE_ORIGIN = `https://${cfg.siteSlug}.here.now`;
export const UPDATE_CHANNEL_PATH = cfg.updateChannelPath;
export const PICKS_COLLECTION = cfg.picksCollection;
export const FEEDBACK_COLLECTION_ID = cfg.feedbackCollection;
