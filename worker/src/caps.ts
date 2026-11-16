// JC-34 (audit P1-1, P1-2): atomic counters on Cloudflare D1 (free plan), per Security Lead's JC-20 "stay-free fallback".
// KV has no compare-and-swap, so concurrent isolates could all pass a read-then-write cap check. D1 runs each
// batch() as ONE SQLite transaction on a single writer, so "check the cap + count it" can't interleave with another
// request. Money is stored as integer micro-dollars (no float drift).
//   reserve  -> refuses (daily_limit / cap_reached) or counts the question AND adds the worst-case cost, in one step
//   finalize -> swaps the reservation for the real cost
//   release  -> upstream failed: gives back the question and the reserved cost
//   take     -> atomic fixed-window rate counters (snapshot writes/reads, link-code tries)
//   backoffTake / backoffFail / backoffUntake -> leaderboard unlock: per-IP (/64) or per-paired-device backoff
//              (5 tries an hour, then a 1h, 2h, 4h ... 24h lockout) plus a SOFT global trip (JC-34 round 2, P2-2)
// If D1 is missing or errors, callers fail CLOSED (no upstream call, no password compare).
//
// RELIES ON D1 batch() BEING ONE TRANSACTION. Cloudflare's D1 docs: "Batched statements are SQL transactions. If a
// statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back
// the entire sequence." Every check-and-count below (reserve, take) and every settle (finalize, release) is ONE batch()
// call with no awaits in between, so another request can't run between the guard and the increments, and a failure
// half-way leaves no partial count. Do NOT split these batches or replace batch() with separate run() calls; the
// "one batch, transactional" contract is pinned by tests in test/jc34.test.ts. A single UPDATE ... RETURNING guard is
// not used because reserve() must touch three tables (res, daily, spend) and a SQLite UPDATE changes only one.

export interface D1Result<T = Record<string, unknown>> { results?: T[]; meta?: { changes?: number } }
export interface D1PreparedStatement { bind(...v: unknown[]): D1PreparedStatement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<D1Result> }
export interface D1Database { prepare(sql: string): D1PreparedStatement; batch(s: D1PreparedStatement[]): Promise<D1Result[]> }

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS spend (month TEXT PRIMARY KEY, micros INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS daily (dev TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dev, day))`,
  `CREATE TABLE IF NOT EXISTS res (id TEXT PRIMARY KEY, dev TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, micros INTEGER NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL)`,
  // JC-34 round 2 (Security Lead P2-1/P2-3): tokens carry an expiry (sliding, `exp`) and the password generation they were
  // minted under (`pw`, a short hash; rotating LB_PASSWORD revokes every token). A uid is bound by the FIRST live token that
  // claims it; more phones join that uid only with a one-time link code from an already-linked phone (`lblink`).
  // (The round-1 `lbtok` table is gone: it was never deployed, and its tokens had no expiry or generation.)
  `CREATE TABLE IF NOT EXISTS lbtokens (h TEXT PRIMARY KEY, uid TEXT, un TEXT, at INTEGER NOT NULL, exp INTEGER NOT NULL, pw TEXT NOT NULL, seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS lbtokens_uid ON lbtokens (uid)`,
  `CREATE TABLE IF NOT EXISTS lblink (h TEXT PRIMARY KEY, uid TEXT NOT NULL, by TEXT NOT NULL, exp INTEGER NOT NULL)`,
  // P2-2: per-key (IP /64 or paired device) backoff: n tries in the current window; locked until `until`; `strikes` doubles it
  `CREATE TABLE IF NOT EXISTS lbback (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL, until INTEGER NOT NULL DEFAULT 0, strikes INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lbalert (k TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL)`,
];

export const toMicros = (usd: number) => Math.max(0, Math.round(usd * 1e6));
export const fromMicros = (m: number) => Math.round(Number(m) || 0) / 1e6;
const STALE_RES_MS = 60 * 60 * 1000; // a reservation never settled (isolate died) stays billed at worst case; row is dropped

let ready: WeakSet<object> = new WeakSet();
export async function ensureSchema(db: D1Database) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}
export function _resetSchemaCache() { ready = new WeakSet(); }

export type Reserve =
  | { ok: true; id: string; dailyCount: number; monthMicros: number }
  | { ok: false; reason: "daily_limit" | "cap_reached"; dailyCount: number; monthMicros: number };

export async function reserve(db: D1Database, a: {
  id: string; dev: string; day: string; month: string; micros: number; dailyLimit: number; capMicros: number; now: number;
  seedDaily?: number; seedMonthMicros?: number; // one-time carry-over of the old KV counters (only if the row doesn't exist yet)
}): Promise<Reserve> {
  await ensureSchema(db);
  const r = await db.batch([
    db.prepare(`DELETE FROM res WHERE at < ?1`).bind(a.now - STALE_RES_MS),
    db.prepare(`INSERT INTO spend (month, micros) VALUES (?1, ?2) ON CONFLICT (month) DO NOTHING`).bind(a.month, Math.max(0, Math.round(a.seedMonthMicros || 0))),
    db.prepare(`INSERT INTO daily (dev, day, n) VALUES (?1, ?2, ?3) ON CONFLICT (dev, day) DO NOTHING`).bind(a.dev, a.day, Math.max(0, Math.floor(a.seedDaily || 0))),
    // the check: only creates the reservation row if BOTH caps still have room for the worst case
    db.prepare(`INSERT INTO res (id, dev, day, month, micros, at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE (SELECT n FROM daily WHERE dev = ?2 AND day = ?3) < ?7
        AND (SELECT micros FROM spend WHERE month = ?4) + ?5 <= ?8`).bind(a.id, a.dev, a.day, a.month, a.micros, a.now, a.dailyLimit, a.capMicros),
    // the increments: only if that row was just created (same transaction)
    db.prepare(`UPDATE daily SET n = n + 1 WHERE dev = ?1 AND day = ?2 AND EXISTS (SELECT 1 FROM res WHERE id = ?3)`).bind(a.dev, a.day, a.id),
    db.prepare(`UPDATE spend SET micros = micros + ?1 WHERE month = ?2 AND EXISTS (SELECT 1 FROM res WHERE id = ?3)`).bind(a.micros, a.month, a.id),
    db.prepare(`SELECT (SELECT n FROM daily WHERE dev = ?1 AND day = ?2) AS n, (SELECT micros FROM spend WHERE month = ?3) AS m,
      EXISTS (SELECT 1 FROM res WHERE id = ?4) AS ok`).bind(a.dev, a.day, a.month, a.id),
  ]);
  const row: any = r[r.length - 1]?.results?.[0];
  if (!row) throw new Error("caps: no result");
  const dailyCount = Number(row.n) || 0, monthMicros = Number(row.m) || 0;
  if (Number(row.ok) === 1) return { ok: true, id: a.id, dailyCount, monthMicros };
  // same order as before JC-34: the shared monthly budget is reported first
  return { ok: false, reason: monthMicros + a.micros > a.capMicros ? "cap_reached" : "daily_limit", dailyCount, monthMicros };
}

/** Success: month spend -= reserved, += actual (never below 0). Idempotent (no-op once the reservation is gone). */
export async function finalize(db: D1Database, id: string, actualMicros: number) {
  await db.batch([
    db.prepare(`UPDATE spend SET micros = MAX(0, micros - (SELECT micros FROM res WHERE id = ?1) + ?2)
      WHERE month = (SELECT month FROM res WHERE id = ?1)`).bind(id, Math.max(0, Math.round(actualMicros))),
    db.prepare(`DELETE FROM res WHERE id = ?1`).bind(id),
  ]);
}

/** Failure: give back the question and the reserved cost. Idempotent. */
export async function release(db: D1Database, id: string) {
  await db.batch([
    db.prepare(`UPDATE daily SET n = MAX(0, n - 1) WHERE dev = (SELECT dev FROM res WHERE id = ?1) AND day = (SELECT day FROM res WHERE id = ?1)`).bind(id),
    db.prepare(`UPDATE spend SET micros = MAX(0, micros - (SELECT micros FROM res WHERE id = ?1)) WHERE month = (SELECT month FROM res WHERE id = ?1)`).bind(id),
    db.prepare(`DELETE FROM res WHERE id = ?1`).bind(id),
  ]);
}

/** Counters as stored (month spend includes in-flight reservations, so usage never looks under the cap mid-flight). */
export async function usage(db: D1Database, dev: string, day: string, month: string, seedDaily = 0, seedMonthMicros = 0) {
  await ensureSchema(db);
  const row: any = await db.prepare(`SELECT (SELECT n FROM daily WHERE dev = ?1 AND day = ?2) AS n, (SELECT micros FROM spend WHERE month = ?3) AS m`).bind(dev, day, month).first();
  return { dailyCount: row?.n == null ? seedDaily : Number(row.n), monthMicros: row?.m == null ? seedMonthMicros : Number(row.m) };
}

/** Atomic fixed-window counters: counts one hit on EVERY key only if ALL keys are under their limits. */
export async function take(db: D1Database, id: string, keys: { k: string; limit: number; ttlSec: number }[], now: number): Promise<boolean> {
  await ensureSchema(db);
  const mark = "ok:" + id;
  const conds = keys.map((_, i) => `(SELECT n FROM hits WHERE k = ?${2 + i * 2}) < ?${3 + i * 2}`).join(" AND ");
  const r = await db.batch([
    db.prepare(`DELETE FROM hits WHERE exp <= ?1`).bind(now),
    ...keys.map((x) => db.prepare(`INSERT INTO hits (k, n, exp) VALUES (?1, 0, ?2) ON CONFLICT (k) DO NOTHING`).bind(x.k, now + x.ttlSec * 1000)),
    db.prepare(`INSERT INTO hits (k, n, exp) SELECT ?1, 1, ${now + 60_000} WHERE ${conds}`).bind(mark, ...keys.flatMap((x) => [x.k, x.limit])),
    ...keys.map((x) => db.prepare(`UPDATE hits SET n = n + 1 WHERE k = ?1 AND EXISTS (SELECT 1 FROM hits WHERE k = ?2)`).bind(x.k, mark)),
    db.prepare(`SELECT EXISTS (SELECT 1 FROM hits WHERE k = ?1) AS ok`).bind(mark),
    db.prepare(`DELETE FROM hits WHERE k = ?1`).bind(mark),
  ]);
  return Number((r[r.length - 2]?.results?.[0] as any)?.ok) === 1;
}
/** Give one hit back (a correct password shouldn't use up the family's attempts). */
export async function untake(db: D1Database, keys: string[]) {
  await db.batch(keys.map((k) => db.prepare(`UPDATE hits SET n = MAX(0, n - 1) WHERE k = ?1`).bind(k)));
}

// ---------- JC-34 round 2 (Security Lead P2-2): per-key backoff + soft global trip ----------
export const BACKOFF = { perWindow: 5, windowMs: 3_600_000, baseMs: 3_600_000, maxMs: 24 * 3_600_000, strikeResetMs: 24 * 3_600_000 };
const KEEP_MS = BACKOFF.strikeResetMs + BACKOFF.maxMs + BACKOFF.windowMs;
export type Backoff = { ok: true } | { ok: false; why: "backoff" | "global" };

/** ONE batch (one transaction): allowed only if `key` isn't locked out and has tries left in its window (and, when given,
 * the soft global counter is under its ceiling). Counts the try on the key and the global counter BEFORE the caller
 * compares anything. A window ends 1 hour after it started; strikes reset after a clean day. */
export async function backoffTake(db: D1Database, id: string, key: string, global: { k: string; limit: number; ttlSec: number } | null, now: number): Promise<Backoff> {
  await ensureSchema(db);
  const mark = "ok:" + id, B = BACKOFF;
  const gcond = global ? ` AND (SELECT n FROM hits WHERE k = ?4) < ?5` : "";
  const st = [
    db.prepare(`DELETE FROM lbback WHERE exp <= ?1`).bind(now),
    db.prepare(`INSERT INTO lbback (k, n, win, until, strikes, exp) VALUES (?1, 0, ?2, 0, 0, ?3) ON CONFLICT (k) DO NOTHING`).bind(key, now, now + KEEP_MS),
    db.prepare(`UPDATE lbback SET n = 0, win = ?2 WHERE k = ?1 AND until <= ?2 AND win + ?3 <= ?2`).bind(key, now, B.windowMs),
    db.prepare(`UPDATE lbback SET strikes = 0 WHERE k = ?1 AND strikes > 0 AND until + ?3 <= ?2`).bind(key, now, B.strikeResetMs),
    ...(global ? [db.prepare(`DELETE FROM hits WHERE exp <= ?1`).bind(now), db.prepare(`INSERT INTO hits (k, n, exp) VALUES (?1, 0, ?2) ON CONFLICT (k) DO NOTHING`).bind(global.k, now + global.ttlSec * 1000)] : []),
    db.prepare(`INSERT INTO hits (k, n, exp) SELECT ?1, 1, ?6 WHERE (SELECT until FROM lbback WHERE k = ?2) <= ?3 AND (SELECT n FROM lbback WHERE k = ?2) < ?7${gcond}`)
      .bind(mark, key, now, global?.k ?? "", global?.limit ?? 0, now + 60_000, B.perWindow),
    db.prepare(`UPDATE lbback SET n = n + 1, exp = MAX(exp, ?3) WHERE k = ?1 AND EXISTS (SELECT 1 FROM hits WHERE k = ?2)`).bind(key, mark, now + KEEP_MS),
    ...(global ? [db.prepare(`UPDATE hits SET n = n + 1 WHERE k = ?1 AND EXISTS (SELECT 1 FROM hits WHERE k = ?2)`).bind(global.k, mark)] : []),
    db.prepare(`SELECT EXISTS (SELECT 1 FROM hits WHERE k = ?1) AS ok, (SELECT until FROM lbback WHERE k = ?2) > ?3 AS locked, (SELECT n FROM lbback WHERE k = ?2) >= ?4 AS spent`).bind(mark, key, now, B.perWindow),
    db.prepare(`DELETE FROM hits WHERE k = ?1`).bind(mark),
  ];
  const r = await db.batch(st);
  const row: any = r[r.length - 2]?.results?.[0];
  if (!row) throw new Error("backoff: no result");
  if (Number(row.ok) === 1) return { ok: true };
  return { ok: false, why: Number(row.locked) === 1 || Number(row.spent) === 1 ? "backoff" : "global" };
}
/** A wrong answer: once the window's tries are used up, lock the key out for 1h, 2h, 4h ... (max 24h). Only one of
 * several parallel failures can lock (n is reset in the same statement), so one burst = one strike. */
export async function backoffFail(db: D1Database, key: string, now: number) {
  const B = BACKOFF;
  await db.prepare(`UPDATE lbback SET until = ?2 + MIN(?3, ?4 * (1 << MIN(strikes, 10))), strikes = strikes + 1, n = 0, win = ?2,
    exp = MAX(exp, ?2 + ?5) WHERE k = ?1 AND n >= ?6 AND until <= ?2`).bind(key, now, B.maxMs, B.baseMs, KEEP_MS, B.perWindow).run();
}
/** A right answer gives its try back (on the key and the global counter). */
export async function backoffUntake(db: D1Database, key: string, globalKey: string | null) {
  await db.batch([
    db.prepare(`UPDATE lbback SET n = MAX(0, n - 1) WHERE k = ?1`).bind(key),
    ...(globalKey ? [db.prepare(`UPDATE hits SET n = MAX(0, n - 1) WHERE k = ?1`).bind(globalKey)] : []),
  ]);
}
/** Owner alert row (read with `python3 tools/leaderboard.py lb-admin alerts`). */
export async function raiseAlert(db: D1Database, k: string, now: number) {
  await db.prepare(`INSERT INTO lbalert (k, n, first, last) VALUES (?1, 1, ?2, ?2) ON CONFLICT (k) DO UPDATE SET n = n + 1, last = ?2`).bind(k, now).run();
}
