# Galaxy Gridiron

> 🤖 This project was created by [Grok Bot](https://cursor.com) from Cursor.

Read-only fantasy football companion for Sleeper leagues. Expo / React Native (TypeScript) Android app plus an iPhone PWA export, with an optional Cloudflare Worker (`worker/`) for the AI chat.

- `app/`: the app. Inside `app/`: `npm install && npm test && npx tsc --noEmit`.
- `worker/`: AI proxy (Workers free plan). Inside `worker/`: `npm install && npm test`.
- `tools/`: publishing and analysis scripts. See `tools/PUBLISHING.md`.
- `build-apk.sh`: local release build (needs the Android SDK and the signing key in `keys/`).

## Config
All deployment values live in one gitignored file, `app/config.local.json`. Copy `app/config.example.json` to `app/config.local.json` and fill it in. The app bundles only four public keys (`siteSlug`, `updateChannelPath`, `picksCollection`, `feedbackCollection`): `tools/gen-appconfig.sh` copies them into the gitignored `app/src/appconfig.generated.json` (run by the build scripts and by `npm install` / `npm test` / `npm run typecheck`), which `app/src/config.ts` imports explicitly. A clean clone gets the placeholder values (from `app/config.example.json`, or `app/src/appconfig.default.json` if `jq` is missing), so tests and type-checks run, but nothing can be published. `build-apk.sh` and `tools/make_pwa.sh` finish with `tools/leak-check.sh`, which fails the build if any other config value (keystore password, secret paths, Sleeper ids) is found in the APK or PWA. The signing keystore stays in `keys/` (gitignored). Never commit real values.
