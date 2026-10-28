// The ONE place app code reads deployment-specific values (site slug, update channel, collections).
// Only these 4 public keys are ever bundled. build-apk.sh / tools/make_pwa.sh run tools/gen-appconfig.sh, which uses jq
// to copy just these keys from the gitignored app/config.local.json (or config.example.json placeholders) into the
// gitignored app/src/appconfig.generated.json. A fresh clone without it falls back to the committed placeholder
// app/src/appconfig.default.json, so tsc and tests still run (such a build cannot reach the real site).
// NEVER require config.local.json here: it holds the keystore password, secret paths and Sleeper ids.
export type AppConfig = {
  siteSlug: string;
  updateChannelPath: string;
  picksCollection: string;
  feedbackCollection: string;
};
declare const require: (id: string) => any;
let cfg: AppConfig;
try { cfg = require('./appconfig.generated.json'); } catch { cfg = require('./appconfig.default.json'); }
export const CONFIG: AppConfig = {
  siteSlug: cfg.siteSlug,
  updateChannelPath: cfg.updateChannelPath,
  picksCollection: cfg.picksCollection,
  feedbackCollection: cfg.feedbackCollection,
};
export const SITE_SLUG = CONFIG.siteSlug;
export const SITE_ORIGIN = `https://${CONFIG.siteSlug}.here.now`;
export const UPDATE_CHANNEL_PATH = CONFIG.updateChannelPath;
export const PICKS_COLLECTION = CONFIG.picksCollection;
export const FEEDBACK_COLLECTION_ID = CONFIG.feedbackCollection;
