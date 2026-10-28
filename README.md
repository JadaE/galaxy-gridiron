# Galaxy Gridiron

Read-only fantasy football companion for Sleeper leagues. Expo / React Native (TypeScript) Android app plus an iPhone PWA export, with an optional Cloudflare Worker (`worker/`) for the AI chat.

- `app/`: the app. Inside `app/`: `npm install && npm test && npx tsc --noEmit`.
- `worker/`: AI proxy (Workers free plan). Inside `worker/`: `npm install && npm test`.
- `tools/`: publishing and analysis scripts. See `tools/PUBLISHING.md`.
- `build-apk.sh`: local release build (needs the Android SDK and the signing key in `keys/`).

## Config
All deployment values live in one gitignored file, `app/config.local.json`. Copy `app/config.example.json` to `app/config.local.json` and fill it in. Without it, code falls back to `config.example.json` (placeholders), so tests and type-checks run, but nothing can be published. The signing keystore stays in `keys/` (gitignored). Never commit real values.
