# galaxy-gridiron-ai (Cloudflare Worker)

A small, read-only AI proxy for the Galaxy Gridiron app. The app never holds an AI key.

- `src/index.ts`: routes (`/pair`, `/chat`, `/usage`), caps and KV counters
- `src/pricing.ts`: model prices and cost math. `src/prompt.ts`: system prompt
- `CONTRACT.md`: API contract for the app. `SETUP.md`: deploy steps
- `test/worker.test.ts`: 24 vitest tests with a mocked upstream and in-memory KV

```
npm install
npm test             # unit tests
npm run typecheck
npm run check        # typecheck + tests + wrangler dry-run bundle (needs Node >= 22)
```
Secrets are set only with `npx wrangler secret put OPENAI_API_KEY` and `npx wrangler secret put PAIRING_CODE`. Never put them in files.
Config (`wrangler.toml [vars]`): `MONTH_CAP_USD`=5, `DAILY_LIMIT`=30, `MAX_DEVICES`=5, `TIMEZONE`, `BUDGET_MODEL`, `BETTER_MODEL`.
Free plan: 100k requests/day; KV free tier is 1,000 writes/day (each chat uses 2 writes).
