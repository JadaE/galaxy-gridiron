# Galaxy Gridiron AI proxy: API contract (v1)

Base URL: the Worker URL the owner enters in **Settings > AI**, e.g. `https://galaxy-gridiron-ai.<her-subdomain>.workers.dev`.
All bodies are JSON (`content-type: application/json`). All responses are JSON with `cache-control: no-store`.
The Worker is a **read-only advisor**: it never touches Sleeper, and the app never holds an AI key.

## POST /pair
Request: `{ "code": string, "deviceName": string }`
- `code` is compared (constant-time, SHA-256 both sides) with the `PAIRING_CODE` secret, after trimming spaces.
- On success a random 256-bit token (`gg_` + base64url) is issued. Only its SHA-256 is stored in KV (`device:<sha256>` → `{deviceName, createdAt}`).

200: `{ "deviceToken": string }`. The app stores it in SecureStore and sends it as `Authorization: Bearer <deviceToken>`.

Errors (`{ error, message }`):
| HTTP | error | when |
|---|---|---|
| 400 | `bad_request` | body not JSON / fields not strings |
| 403 | `bad_code` | wrong code (counts toward rate limit) |
| 429 | `rate_limited` | JC-34 round 2: each try is counted in D1 before the compare. 5 tries an hour per IP (IPv6 by /64); using them up locks that network for 1h, then 2h, 4h ... up to 24h. A SOFT global counter (200 tries a day) returns 429 past it and writes an owner alert (`lb-admin alerts`); phones already paired are never affected |
| 403 | `device_limit` | already `MAX_DEVICES` (default 5) paired devices |
| 503 | `not_configured` | `PAIRING_CODE` secret not set yet |
| 503 | `unavailable` | D1 missing or erroring (fails closed: the code is not compared) |

## POST /chat
Headers: `Authorization: Bearer <deviceToken>`
Request:
```json
{ "tier": "budget" | "better",
  "messages": [ { "role": "user" | "assistant", "content": "..." } ],
  "context": { } }
```
Limits (else `bad_request`): 1–20 messages; each ≤4,000 chars; all messages ≤16,000 chars total; last message must be `user`; `context` must be a JSON object ≤16,000 chars when stringified (~4k tokens); whole body ≤64 KB (413).
`context` is the app's league snapshot (league/scoring, her starters+bench with proj/injury/consistency/bye, opponent, waiver fits, trade ideas, standings). It is sent to the model as data, not instructions.

200:
```json
{ "reply": "string",
  "costUsd": 0.0006,
  "monthSpendUsd": 0.0123,
  "monthCapUsd": 5,
  "dailyCount": 3,
  "dailyLimit": 30,
  "model": "gpt-6-luna" }
```
- `costUsd` = this request, computed from upstream token usage × the model's list price (uncached input, cached input, cache writes and output, with reasoning tokens counted as output). If upstream omits usage, a worst-case estimate is billed.
- `monthSpendUsd` is shared by all paired devices (one budget). `dailyCount`/`dailyLimit` are **per device**.
- Month and day roll over at local midnight in `TIMEZONE` (default America/Chicago).

Errors: `{ error, message }`. Cap, daily-limit and upstream errors also include the four usage fields so the cost counter can update.
| HTTP | error | when |
|---|---|---|
| 401 | `unpaired` | missing/unknown token → show "Pair again" in Settings > AI |
| 400 / 413 | `bad_request` | validation failed (message says why) |
| 429 | `cap_reached` | `monthSpendUsd >= monthCapUsd`. Checked **before** any upstream call |
| 429 | `daily_limit` | `dailyCount >= dailyLimit`. Checked **before** any upstream call |
| 502 | `upstream` | provider error or unreachable; not charged; the daily slot is released. Message tells "prepaid balance/spend limit used up" apart from "busy" |
| 503 | `not_configured` | AI key secret missing, or model var set to a model with no price on file |

Upstream call: OpenAI Responses API (`POST https://api.openai.com/v1/responses`), `store:false`, fixed system prompt (read-only, fantasy-football only, never claims to act on Sleeper, no betting picks).
| tier | model | max_output_tokens | reasoning.effort |
|---|---|---|---|
| budget | `gpt-6-luna` | 700 | none |
| better | `gpt-6.1-sol` | 1200 | low |

App UX: fall back to the Rules chat on any error. Show `cap_reached` and `daily_limit` messages as-is.

## GET /usage
Headers: `Authorization: Bearer <deviceToken>`
200: `{ "monthSpendUsd": number, "monthCapUsd": number, "dailyCount": number, "dailyLimit": number }`
401: `unpaired`.

## GET /
Health check: `{ "ok": true, "service": "galaxy-gridiron-ai", "readOnly": true }`. Lets the app check the URL when the owner enters it.

## Changes vs the brief (all additive, no breaking changes)
1. `/chat` 200 also returns `model`, so the cost counter can show which model answered.
2. `/chat` `cap_reached`/`daily_limit`/`upstream` errors also carry the usage fields.
3. `/pair` has the extra error codes `bad_code`, `rate_limited`, `device_limit`, `not_configured` (the brief only listed /chat errors). There's also `not_found` (404) for unknown routes.
4. Added `GET /` health check.
5. Added `MAX_DEVICES` var (default 5) so a leaked pairing code can't pair unlimited phones.

## JC-34 changes (v0.0.15)

### Atomic caps (D1)
`/chat` now reserves before calling OpenAI, in ONE D1 transaction (`src/caps.ts`): if `dailyCount >= dailyLimit` or `monthSpend + worstCase > monthCap` it refuses (`daily_limit` / `cap_reached`, 429, no upstream call); otherwise it counts the question and adds the worst-case cost (input UTF-8 bytes as tokens + max output tokens). Success swaps the reservation for the real cost; an upstream error or network failure releases it (question and cost given back). `GET /usage` reads the same D1 counters, including in-flight reservations. The old KV `spend:`/`daily:` values are read only to seed D1 rows that don't exist yet (cut-over), never as a fallback.

| HTTP | error | when |
|---|---|---|
| 503 | `unavailable` | D1 binding missing or erroring. `/chat` and `/usage` fail closed: no OpenAI call |

### Shared leaderboard (`/lb/*`)
All need the leaderboard secrets (`LB_PASSWORD`, `LB_LIVE`, `LB_ARCHIVE`, `LB_SITE_SLUG`, `HERENOW_API_KEY`) and D1, else 503 `not_configured` / `unavailable`. JC-34 round 2 (C1): `LB_LIVE` and `LB_ARCHIVE` must be two different RANDOM names (32-64 of `A-Za-z0-9_-`, made by `tools/leaderboard.py rotate new`); the old password-derived names are refused with 503 `not_configured`.
- `POST /lb/unlock {password}` (optional header `X-GG-Device: gg_...`, this phone's AI device token from `/pair`) -> `{token}` (`lb_` + 256-bit). Each try is counted in D1 BEFORE the constant-time compare (P2-2):
  - per IP (IPv6 by /64), or per paired device when `X-GG-Device` is valid: 5 tries per hour; using them up locks that key for 1h, then 2h, 4h ... up to 24h (strikes reset after a clean day). 429 `rate_limited`.
  - a SOFT global counter (200 tries a day, IP requests only): past it, IP requests get 429 and an owner alert row is written (`lb-admin alerts`); paired devices still get through. Phones that already have a token are never affected.
  - Wrong = 403 `bad_code` (one message for every wrong answer). A correct unlock gives its try back. At most 10 new tokens per IP/device per day.
  - Only SHA-256(token) is stored (`lbtokens`), with an expiry (180 days, sliding on use) and an 8-hex-char tag of the current password; a token minted under an older password is rejected (401), so rotating `LB_PASSWORD` revokes every token (P2-3).
- `POST /lb/join {uid, un, link?}` (Bearer lb token) -> binds the token to one Sleeper user id (P2-1). The FIRST live token to claim a uid wins; another token gets 409 `uid_taken` unless it sends a valid `link` code made for that uid (wrong/used/expired code = 403 `bad_code`; 5 code tries per token per hour). A token already bound to another uid = 403 `forbidden`.
- `POST /lb/link` (Bearer, joined) -> `{code: "XXXX-XXXX-XXXX", expiresInSec: 600}`: one-time, 10-minute, 60-bit code for adding ONE more phone to the same uid (only its hash is stored). Max 5 live phones per uid (409 `device_limit`), checked when a code is made AND atomically when it is redeemed (an unused code survives a "full" refusal); 5 codes per token per hour.
- `POST /lb/logout` (Bearer) -> `{ok: true}`: deletes this token (and its link codes) on the server.
- Expired, revoked or old-password tokens get 401 `unpaired` on every route. Owner reset: `python3 tools/leaderboard.py lb-admin revoke-uid UID | revoke-all [--apply]`.
- `POST /lb/snap {season, week, picks, bf, ts, un?, av?, key?}` (Bearer) -> 201. Written to the live collection as the bound uid only; a body naming another uid = 403; not joined = 403. 120 writes per token per hour.
- `GET /lb/snaps?season=YYYY` (Bearer) -> `{records: [{id, uid, un, av?, season, week, picks, bf, ts, createdAt}]}`, live + archive merged (archive uses its original time). Other people's `picks`/`bf` for a game are omitted until that game's kickoff, from the ESPN schedule the Worker fetches itself; unknown kickoff = hidden. The caller's own bound uid is always shown. 600 reads per token per hour.
