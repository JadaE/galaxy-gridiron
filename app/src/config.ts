// The ONE place app code reads deployment-specific values. Only these 5 public keys are ever bundled.
// tools/gen-appconfig.sh (run by build-apk.sh, tools/make_pwa.sh, and `npm install` / `npm test` in app/) writes the
// gitignored app/src/appconfig.generated.json from app/config.local.json, falling back to the committed placeholders.
// v0.0.12 (store version): no private update channel and no picks collection in the bundle. The update check reads the
// PUBLIC store channel (<site>/<publicUpdatePath>/version.json). feedbackEnabled is the single switch for the feedback form.
// JC-34 (v0.0.15): leaderboardApi is the AI Worker's public URL; the shared leaderboard is unlocked there (server-side,
// rate-limited). Empty = no shared leaderboard in this build.
// NEVER import config.local.json here: it holds the keystore password, secret paths and Sleeper ids.
import generated from './appconfig.generated.json';
export type AppConfig = {
  siteSlug: string;
  publicUpdatePath: string;
  feedbackEnabled: boolean;
  feedbackCollection: string;
  leaderboardApi: string;
};
const cfg: AppConfig = generated as AppConfig;
export const CONFIG: AppConfig = {
  siteSlug: cfg.siteSlug,
  publicUpdatePath: cfg.publicUpdatePath,
  feedbackEnabled: cfg.feedbackEnabled === true && !!cfg.feedbackCollection,
  feedbackCollection: cfg.feedbackCollection,
  // an unfilled YOUR-* / YOUR_* placeholder is never used as an endpoint
  leaderboardApi: typeof cfg.leaderboardApi === 'string' && !/your[-_]/i.test(cfg.leaderboardApi) ? cfg.leaderboardApi.replace(/\/+$/, '') : '',
};
export const SITE_SLUG = CONFIG.siteSlug;
export const SITE_ORIGIN = `https://${CONFIG.siteSlug}.here.now`;
export const PUBLIC_UPDATE_PATH = CONFIG.publicUpdatePath;
export const FEEDBACK_ENABLED = CONFIG.feedbackEnabled;
export const FEEDBACK_COLLECTION_ID = CONFIG.feedbackCollection;
export const LEADERBOARD_API = CONFIG.leaderboardApi;
