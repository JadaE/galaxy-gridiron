# JC-109: publish plan for the family live Site Data schema (Review & Release)

Do **not** release or deploy the JC-109 app until this schema is live. Trade-chip writes (`typ: 'tags'`) must not go out while the published live collection still requires `picks`, `season` and `week`. This plan is schema-only: it does not bump the app version and must not ship the unreleased JC-109 client.

Never print or commit the collection name, the leaderboard password, its hash, or any keys.

## What changes

`tools/leaderboard.py manifest` applies the name-free overlay in `tools/family-live-schema.json` to the **live** family collection only:

- Adds optional fields: `typ`, `tags`, `league`, `at`.
- Makes `season`, `week` and `picks` optional (they stay in the schema, so existing pick records still validate).
- Archive, the closed pre-password picks collection, and the feedback block are left unchanged.

Tag records omit `season`, `week` and `picks`. Do not pad them. Shipped v0.0.12 and v0.0.14 clients do not check `typ`; a record with a real season/week and empty `picks` could look like a complete week and clear on-time picks. A tag record that omits those fields does not match `s.season === <season>` in those clients, so existing pick reads stay safe.

## Commands (box only, after review)

From the Galaxy Gridiron repo, with `$GG_LEADERBOARD_PASSWORD` set in the environment (not in a file) and `app/config.local.json` already present:

1. Copy the current gitignored `publish-site/.herenow/data.json` aside (still gitignored; chmod 600) so rollback has an exact previous manifest.
2. Dry run (prints collection counts only, no names):

   `python3 tools/leaderboard.py manifest --dry-run`

3. Check the schema without publishing: `python3 tools/test_family_live_schema.py`. Confirm a fixture pick record still validates and a `typ: 'tags'` record without `season`/`week`/`picks` validates. Do not open or paste the private manifest into chat.
4. Write the gitignored staging manifest only:

   `python3 tools/leaderboard.py manifest`

   This updates `<publishSiteDir>/.herenow/data.json` (gitignored). It does not upload anything.
5. Publish the **already-released** site snapshot so the new live schema goes out, **without** a new app version and **without** the unreleased JC-109 APK. `bash tools/publish.sh <version> <apk-path>` uploads the whole `publish-site/` folder after the release gate; use the current shipped version and its already-released APK, not a JC-109 build. Only Review & Release runs this, and only through the normal gate. Do not publish an empty `{"collections":{}}`.

## After it is live (before any JC-109 client)

- Existing pick records must still be readable by the shipped v0.0.12 / v0.0.14 apps (no typ field, season/week/picks present).
- A probe insert of a typ:tags record that omits season, week and picks should be accepted (201). Do not leave test records if you can avoid it; if one is written, note it for the owner. Do not probe with dummy season/week/empty picks.
- Then JC-109 may be released in a later app batch.

## Rollback

If the schema publish needs to be undone **before** any typ:tags record has been accepted, restore the saved previous `data.json` into `publish-site/.herenow/` and republish the same way (already-released app artifacts, release gate). That returns live to required `season`/`week`/`picks` and no `typ`/`tags`/`league`/`at`.

Do not roll back that way after typ:tags records exist: tightening required `picks`/`season`/`week` can disagree with those records. In that case leave the new schema in place and stop the app release instead.

Archive and other collections are not modified by this manifest step, so they are not part of rollback.
