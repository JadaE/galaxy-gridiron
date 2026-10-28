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
| 429 | `rate_limited` | ≥5 wrong codes from one IP in the current hour, or ≥20 wrong codes total today |
| 403 | `device_limit` | already `MAX_DEVICES` (default 5) paired devices |
| 503 | `not_configured` | `PAIRING_CODE` secret not set yet |

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
