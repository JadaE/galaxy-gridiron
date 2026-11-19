# galaxy-gridiron-ai (Cloudflare Worker)

A small, read-only AI proxy for the Galaxy Gridiron app. The app never holds an AI key. AI caps are enforced atomically on D1 (KV is still used for pairing).

- `src/index.ts`: routes (`/pair`, `/chat`, `/usage`); `src/caps.ts`: atomic AI caps on D1
- `src/pricing.ts`: model prices and cost math. `src/prompt.ts`: system prompt
- `CONTRACT.md`: API contract for the app. `SETUP.md`: deploy steps
- `test/worker.test.ts` and `test/caps.test.ts`: vitest tests with a mocked upstream, in-memory KV, and a transactional fake D1

```
npm install
npm test             # unit tests
npm run typecheck
npm run check        # typecheck + tests + wrangler dry-run bundle (needs Node >= 22)
```
Secrets are set only with `npx wrangler secret put OPENAI_API_KEY` and `npx wrangler secret put PAIRING_CODE`. Never put them in files. For the iPhone web app also set `npx wrangler secret put ALLOWED_ORIGINS` (the site origin, e.g. `https://<site-slug>.here.now`; comma-separate several). Without it, browser (CORS) requests are refused; native apps are unaffected.
Config (`wrangler.toml [vars]`): `MONTH_CAP_USD`=5, `DAILY_LIMIT`=30, `MAX_DEVICES`=5, `TIMEZONE`, `BUDGET_MODEL`, `BETTER_MODEL`.
Free plan: 100k requests/day; KV is used for pairing. AI daily/monthly caps live in D1 (`GG_DB`). The owner creates that database once (`npx wrangler d1 create gg-caps`) and pastes only its `database_id` into `wrangler.toml`. This repo does not auto-provision it, and this change does not deploy the Worker.
