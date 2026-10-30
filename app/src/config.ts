// The ONE place app code reads deployment-specific values (site slug, update channel, collections).
// Only these 4 public keys are ever bundled. tools/gen-appconfig.sh (run by build-apk.sh, tools/make_pwa.sh, and
// `npm install` / `npm test` in app/) writes the gitignored app/src/appconfig.generated.json from app/config.local.json,
// falling back to the committed placeholders (config.example.json, or app/src/appconfig.default.json if jq is missing).
// v0.0.11: ONE explicit import, so the bundler includes exactly one config file (the old try/catch bundled both).
// NEVER import config.local.json here: it holds the keystore password, secret paths and Sleeper ids.
import generated from './appconfig.generated.json';
export type AppConfig = {
  siteSlug: string;
  updateChannelPath: string;
  picksCollection: string;
  feedbackCollection: string;
};
const cfg: AppConfig = generated;
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
