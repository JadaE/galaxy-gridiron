# Galaxy Gridiron

A fantasy football companion for Sleeper leagues. It reads your leagues, rosters, matchups and transactions from Sleeper's public API and adds start/sit advice, waiver and trade ideas, player news, a live game-day view, and an NFL pick'em tracker.

## Layout
- `app/` Expo / React Native app (Android build, plus an iPhone-friendly web app export).
- `worker/` optional Cloudflare Worker that proxies AI chat requests (see `worker/SETUP.md` and `worker/CONTRACT.md`).
- `tools/` build, packaging and screenshot helper scripts.
- `build-apk.sh` local Android release build.

## Run
```bash
cd app
npm install
npm test        # unit tests (see "Tests" below)
npx expo start  # dev server
```
Enter a Sleeper username on first launch.

## Build and publish
`build-apk.sh` builds a release APK and expects a signing keystore under `keys/` (not in this repo). Hosting scripts in `tools/` expect a site slug and secret paths from local config; values in the source are placeholders (`YOUR-SITE-SLUG`, `YOUR_SECRET_PATH`, `YOUR_UPDATE_CHANNEL_PATH`, `YOUR_COLLECTION_ID`) and must be set before publishing.

## Tests
`npm test` (in `app/`) runs offline unit tests against the committed fixtures. Some tests need extra local inputs that are not in this repo:
- `GG_PLAYERS_JSON` (or `data/players_nfl.json` at the repo root): Sleeper's public player dump, `curl -o data/players_nfl.json https://api.sleeper.app/v1/players/nfl`. Needed by `chat.test.ts` and `junk.test.ts`.
- `GG_USER_ID`, `GG_LEAGUE_FS`, `GG_LEAGUE_MG`: your own Sleeper user id and two of your league ids. Without them the live-Sleeper checks in `model.test.ts` / `junk.test.ts` print `SKIP` and the rest still runs. The scripts in `tools/an/` and `tools/shots*.py` read the same variables (plus `GG_LEAGUE_PAST` and `GG_DEMO_USERNAME`).
- The test fixtures use made-up Sleeper ids (`1000000000000000001`, `2000000000000000001`, ...), not real accounts.
- The live-collection check in `sync.test.ts` is skipped while `COLLECTION` is still the `YOUR_COLLECTION_ID` placeholder.

## Not included (set up locally)
- `keys/`: Android signing keystore, its password, and the hosting secret paths / collection ids used by `build-apk.sh` and `tools/*.sh`.
- `.herenow/`, `data/`, `feedback/`, `RELEASE_NOTES.md`, build output (`dist/`, `dist-web/`, `publish-site/`) and screenshots.
- Several scripts in `tools/` and `build-apk.sh` still point at the original author's working folder (`/workspace/fantasy-football`); change those paths before running them elsewhere.
