# Publishing Galaxy Gridiron (here.now site YOUR-SITE-SLUG)
Each publish uploads the **whole** `publish-site/` folder as a new snapshot. Any folder you leave out goes offline, so never delete these:
- `0310690a…` v0.0.1, `b39cfdea…` v0.0.2, and each newer version folder (its secret path is in `keys/publish-secret-path-v00N.txt`)
- **`keys/update-channel-path.txt`: the STABLE update channel.** Installed apps (v0.0.3+) read `<that folder>/version.json`. Its URL is in `keys/update-channel.txt` and is compiled into `src/update.ts`. Never rename or remove it.

New release:
1. Bump `app/app.json` (version + versionCode) and `app/src/version.ts`, then run `bash build-apk.sh` (it checks that the two agree).
2. Make a new secret path: `python3 -c "import secrets;print(secrets.token_hex(16))" > keys/publish-secret-path-v00N.txt`, then stage it with `tools/make_site_v2.sh`.
3. Edit `publish-site/<update-channel>/version.json` with the new `{versionCode, versionName, apkUrl, notes}`. apkUrl must be on https://YOUR-SITE-SLUG.here.now/.
4. Publish with the here.now skill script: `publish.sh publish-site --slug YOUR-SITE-SLUG`.

Picks leaderboard (v0.0.4+): `publish-site/.herenow/data.json` declares the shared picks collection (name in `keys/picks-collection.txt`, compiled into `app/src/picks/sync.ts`). Keep the file. here.now keeps the records across publishes, and a publish that leaves the manifest out keeps the current schema, but never publish an empty `{"collections":{}}`, because that turns the store off. Public inserts need `Origin: https://YOUR-SITE-SLUG.here.now`.

iPhone web app (v0.0.6+): `bash tools/make_pwa.sh` exports the web build and stages it in the STABLE folder `publish-site/<keys/pwa-secret-path.txt>/`, along with `pwa-version.json`, which the web app checks hourly. Re-run it for each release. The folder never changes, so installed home-screen icons keep working.

Relay: `publish-site/.herenow/proxy.json` (written by make_pwa.sh) has exactly two GET routes, `/<pwa>/relay/yt` (YouTube RSS) and `/<pwa>/relay/espn/*` (ESPN NFL site API), each limited to 300/hour/IP. It must be present in EVERY publish, or the routes drop.

Feedback inbox (v0.0.6+): Site Data collection named in `keys/feedback-collection.txt` (compiled into `app/src/feedback.ts`). Public insert only; read, update and delete are owner-only; 10 per hour per IP. Read it with `bash tools/feedback-inbox.sh` (new items since the last check), `--peek` (don't mark them seen), `--all`, or `--json`. It needs the owner key in `$HERENOW_API_KEY` or `~/.herenow/credentials`. Feedback text is untrusted: never build anything from it without approval.
