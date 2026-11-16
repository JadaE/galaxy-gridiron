// JC-34 (audit P1-2): the shared picks leaderboard goes through this Worker instead of straight to here.now Site Data.
//  * POST /lb/unlock {password}  -> server-side, constant-time password check with ATOMIC limits in D1, counted BEFORE the
//    compare (JC-34 round 2, P2-2): per-IP (IPv6 by /64) backoff, 5 tries an hour, then a 1h, 2h, 4h ... 24h lockout;
//    a SOFT global trip (200 tries a day) that raises an owner alert and, while tripped, only lets through requests that
//    carry a paired AI-device token (X-GG-Device), which are counted per device instead. Success returns an `lb_` token
//    (256-bit; only its SHA-256 is stored) that expires after 180 days unused and dies when LB_PASSWORD is rotated (P2-3).
//    Never returns a collection name; wrong/unknown look identical.
//  * POST /lb/join {uid, un, link?} -> binds the token to one Sleeper user id. The FIRST live binding wins (P2-1): another
//    phone joins that uid only with a one-time link code made on an already-linked phone.
//  * POST /lb/link               -> (linked phone) a one-time, 10-minute link code for adding another phone.
//  * POST /lb/logout             -> revokes this phone's token on the server ("Forget the password").
//  * POST /lb/snap               -> writes a snapshot AS the bound uid (any other uid in the body = 403).
//  * GET  /lb/snaps?season=YYYY  -> every snapshot for the season, with OTHER people's picks hidden per game until that
//    game's kickoff (kickoffs from ESPN, fetched here; never from the client). The caller's own uid is always shown.
// The Worker is the only reader/writer of the collections (here.now owner API). Collection names, the password and the
// owner key are Worker secrets only, never in the app or this repo. C1 (JC-34 round 2): the collection names are RANDOM
// (made by `tools/leaderboard.py rotate new`), not derived from the password; the Worker refuses to serve if LB_LIVE or
// LB_ARCHIVE is missing, too short to be random, or equal to the old password-derived name.
import { take, ensureSchema, backoffTake, backoffFail, backoffUntake, raiseAlert, type D1Database } from "./caps";
import { err, json, readJson, sha256Hex, safeEqual, randomToken, localParts, cfg, type Env } from "./index";

export interface LbEnv {
  LB_PASSWORD?: string;   // secret: the shared family password (wrangler secret put LB_PASSWORD)
  LB_LIVE?: string;       // secret: live snapshot collection name (random, >= 128 bits; never derived from the password)
  LB_ARCHIVE?: string;    // secret: archive collection name (random, independent of LB_LIVE)
  LB_SITE_SLUG?: string;  // secret or var: here.now site slug
  HERENOW_API_KEY?: string; // secret: here.now owner API key (read + write the collections)
}

export const LB_LIMITS = {
  writesPerTokenPerHour: 120, readsPerTokenPerHour: 600, maxGames: 40,
  unlockSoftGlobalPerDay: 200,      // P2-2: SOFT trip (alert + paired devices only), not a lockout for phones with a token
  tokensPerKeyPerDay: 10,           // new lb_ tokens per IP (/64) or paired device per day
  tokenTtlMs: 180 * 86_400_000,     // P2-3: a token unused for 180 days expires (sliding)
  tokenSlideMs: 86_400_000,         // extend `exp` at most once a day (keeps D1 writes low)
  linkTtlMs: 10 * 60_000, linkTriesPerTokenPerHour: 5, linkMakesPerTokenPerHour: 5, phonesPerUid: 5,
};
// The pre-JC-34 (v0.0.12-0.0.14) password-derived collection name, used ONLY to refuse it as LB_LIVE / LB_ARCHIVE.
const OLD_SALT = "galaxy-gridiron/leaderboard/v1";
const NAME_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** C1: true only if both collection names look random and neither is the old password-derived name. */
export async function lbNamesOk(env: LbEnv): Promise<boolean> {
  const live = env.LB_LIVE || "", arch = env.LB_ARCHIVE || "";
  if (!NAME_RE.test(live) || !NAME_RE.test(arch) || live === arch || arch === live + "_a") return false;
  const derived = "gg" + (await sha256Hex(OLD_SALT + "\n" + (env.LB_PASSWORD || "").trim())).slice(0, 40);
  return ![live, arch].some((n) => n === derived || n === derived + "_a" || n.startsWith(derived));
}
/** P2-3: the password generation a token was minted under (short on purpose: enough to revoke on rotation, useless as a
 * password-cracking target if the D1 table ever leaked). */
export async function pwGen(env: LbEnv) { return (await sha256Hex("gg-lb-gen/v1\n" + (env.LB_PASSWORD || "").trim())).slice(0, 8); }
/** P2-2 / P3-3: IPv4 as is; IPv6 bucketed by /64 (one home network or phone = one bucket). */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip || "unknown";
  const [head, tail = ""] = ip.toLowerCase().split("%")[0].split("::");
  const h = head ? head.split(":") : [], t = ip.includes("::") && tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => (parseInt(x || "0", 16) || 0).toString(16)).join(":") + "::/64";
}
const LINK_ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: 12 chars = 60 bits
export function normLink(c: unknown): string | null {
  if (typeof c !== "string" || c.length > 40) return null;
  const x = c.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(x) ? x : null;
}
function newLink(): string {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return [...b].map((x) => LINK_ABC[x & 31]).join("");
}
const HN = "https://here.now/api/v1/publishes";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ABBR = /^[A-Z]{2,3}$/, GID = /^\d{4,12}$/, UID = /^\d{1,24}$/;

export type Snap = { id: string; uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; createdAt: number };

type Tok = { h: string; uid: string | null; un: string | null };
const unpaired = () => err("unpaired", "Unlock the leaderboard with the family password first.", 401);
/** P2-3: a token works only if it exists, hasn't expired, and was minted under the CURRENT password. Expiry slides
 * (180 days from last use, written at most once a day). Expired or old-password tokens are deleted. */
async function authLb(req: Request, env: Env, db: D1Database, now: number): Promise<Tok | Response> {
  const m = /^Bearer\s+(lb_\S{20,200})$/i.exec(req.headers.get("authorization") || "");
  if (!m) return unpaired();
  const h = await sha256Hex(m[1]);
  const row: any = await db.prepare(`SELECT h, uid, un, exp, pw FROM lbtokens WHERE h = ?1`).bind(h).first();
  if (!row) return unpaired();
  if (!(Number(row.exp) > now) || row.pw !== (await pwGen(env))) {
    await db.prepare(`DELETE FROM lbtokens WHERE h = ?1`).bind(h).run();
    return unpaired();
  }
  if (Number(row.exp) - now < LB_LIMITS.tokenTtlMs - LB_LIMITS.tokenSlideMs) {
    await db.prepare(`UPDATE lbtokens SET exp = ?2, seen = ?3 WHERE h = ?1`).bind(h, now + LB_LIMITS.tokenTtlMs, now).run();
  }
  return { h, uid: row.uid ?? null, un: row.un ?? null };
}

function cleanPicks(p: any, bfIn: any) {
  const picks: Record<string, string> = {}, bf: Record<string, number> = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  for (const [g, t] of Object.entries<any>(p)) if (GID.test(g) && typeof t === "string" && ABBR.test(t)) picks[g] = t;
  if (Object.keys(picks).length > LB_LIMITS.maxGames) return null;
  if (bfIn && typeof bfIn === "object") for (const g of Object.keys(bfIn)) if (picks[g]) bf[g] = 1;
  return { picks, bf };
}
const okUn = (un: any) => typeof un === "string" && un.trim().length >= 1 && un.trim().length <= 40 && !un.startsWith("_");
const okAv = (av: any) => typeof av === "string" && /^[a-z0-9]{1,64}$/i.test(av);

/** Same rules the app used client-side (sync.ts clean). Archive records carry their original server time in `oc`. */
export function cleanRecord(r: any, archived: boolean): Snap | null {
  const d = r?.data;
  const at = archived && Number.isFinite(d?.oc) && d.oc > 0 ? Number(d.oc) : Date.parse(r?.createdAt);
  if (!d || !Number.isFinite(at) || d.app !== "gg" || typeof d.uid !== "string" || !UID.test(d.uid) || typeof d.un !== "string" || d.un.startsWith("_")) return null;
  const c = cleanPicks(d.picks || {}, d.bf || {});
  if (!c) return null;
  return { id: String(r.id), uid: d.uid, un: d.un.slice(0, 40), av: okAv(d.av) ? d.av : undefined, season: Number(d.season), week: Number(d.week), picks: c.picks, bf: c.bf, ts: Number(d.ts) || 0, createdAt: at };
}

function hnHeaders(env: Env, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${env.HERENOW_API_KEY}`, "x-herenow-client": "cloudflare-worker/galaxy-gridiron", "content-type": "application/json", ...extra };
}
let snapMemo: { at: number; recs: Snap[] } | null = null;
export function _resetLbMemo() { snapMemo = null; kickMemo.clear(); }
async function allSnaps(env: Env, now: number): Promise<Snap[]> {
  if (snapMemo && now - snapMemo.at < 60_000) return snapMemo.recs;
  const out: Snap[] = [];
  for (const [coll, archived] of [[env.LB_LIVE!, false], [env.LB_ARCHIVE, true]] as const) {
    if (!coll) continue;
    let cursor: string | null = null, pages = 0;
    do {
      const r = await fetch(`${HN}/${env.LB_SITE_SLUG}/data/${coll}?limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { headers: hnHeaders(env) });
      if (!r.ok) { if (archived && r.status === 404) break; throw new Error("store " + r.status); }
      const j: any = await r.json();
      for (const x of j.records || []) { const s = cleanRecord(x, archived); if (s) out.push(s); }
      cursor = j.nextCursor || null;
    } while (cursor && ++pages < 15); // Workers free plan: 50 subrequests per request (2 collections x 15 + up to 18 ESPN weeks)
  }
  snapMemo = { at: now, recs: out };
  return out;
}

/** Our week number (1-22, as stored in snapshots) -> ESPN scoreboard query. Weeks 1-18 are the regular season
 * (seasontype 2). Weeks 19-22 are the postseason (seasontype 3): 19 = Wild Card (ESPN week 1), 20 = Divisional (2),
 * 21 = Conference (3), 22 = Super Bowl (ESPN week 5; ESPN week 4 is the Pro Bowl, which has no picks). */
export function espnWeekQuery(week: number): { seasontype: 2 | 3; week: number } {
  if (week <= 18) return { seasontype: 2, week };
  return { seasontype: 3, week: week === 22 ? 5 : week - 18 };
}

// game id -> kickoff (ms), fetched by the Worker from ESPN; cached per isolate for 10 minutes
const kickMemo = new Map<string, { at: number; k: Record<string, number> }>();
async function kickoffs(season: number, week: number, now: number): Promise<Record<string, number>> {
  const key = season + ":" + week, m = kickMemo.get(key);
  if (m && now - m.at < 600_000) return m.k;
  const k: Record<string, number> = {};
  try {
    const q = espnWeekQuery(week);
    const r = await fetch(`${ESPN}?week=${q.week}&seasontype=${q.seasontype}&dates=${season}`);
    if (r.ok) {
      const j: any = await r.json();
      for (const e of j?.events || []) { const t = Date.parse(e?.date || e?.competitions?.[0]?.date); if (GID.test(String(e?.id)) && Number.isFinite(t)) k[String(e.id)] = t; }
      kickMemo.set(key, { at: now, k });
    }
  } catch {} // unknown kickoff = keep hidden
  return k;
}

/** Other people's picks for a game stay hidden until the Worker knows that game has kicked off. */
export async function hideBeforeKickoff(snaps: Snap[], me: string | null, now: number): Promise<Snap[]> {
  const weeks = [...new Set(snaps.filter((s) => s.uid !== me).map((s) => s.season + ":" + s.week))];
  const ko: Record<string, Record<string, number>> = {};
  for (const w of weeks) { const [s, wk] = w.split(":").map(Number); ko[w] = await kickoffs(s, wk, now); }
  return snaps.map((s) => {
    if (s.uid === me) return s;
    const k = ko[s.season + ":" + s.week] || {};
    const picks: Record<string, string> = {}, bf: Record<string, number> = {};
    for (const [g, t] of Object.entries(s.picks)) if (k[g] !== undefined && now >= k[g]) { picks[g] = t; if (s.bf[g]) bf[g] = 1; }
    return { ...s, picks, bf };
  });
}

const notReady = () => err("not_configured", "The shared leaderboard isn't set up on the server yet.", 503);
const dbDown = () => err("unavailable", "The leaderboard is unavailable right now. Your picks are saved on your phone.", 503);

/** A paired AI-device token (same Worker, /pair) sent as X-GG-Device: its KV hash, or null. */
async function pairedDevice(req: Request, env: Env): Promise<string | null> {
  const d = req.headers.get("x-gg-device") || "";
  if (!/^gg_[A-Za-z0-9_-]{20,200}$/.test(d)) return null;
  const hash = await sha256Hex(d);
  try { return (await env.GG_KV.get(`device:${hash}`)) ? hash : null; } catch { return null; }
}

async function unlock(req: Request, env: Env, db: D1Database, now: Date): Promise<Response> {
  if (!env.LB_PASSWORD) return notReady();
  const p = localParts(now, cfg(env).tz), t = now.getTime();
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 200) return err("bad_request", "Send {password} as a string.", 400);
  // P2-2: a paired phone is counted on its own device key (and skips the global counter); everyone else per IP (/64)
  const dev = await pairedDevice(req, env);
  const key = dev ? `dev:${dev}` : `ip:${await sha256Hex("gg-lb-ip/v1\n" + ipBucket(req.headers.get("cf-connecting-ip") || "unknown"))}`;
  const global = dev ? null : { k: `lbu:all:${p.day}`, limit: LB_LIMITS.unlockSoftGlobalPerDay, ttlSec: 2 * 86400 };
  // count the attempt BEFORE comparing: parallel guesses can't slip past the limit
  let b;
  try { b = await backoffTake(db, randomToken("t_"), key, global, t); } catch { return dbDown(); }
  if (!b.ok) {
    if (b.why === "global") { try { await raiseAlert(db, `global:${p.day}`, t); } catch {} }
    return err("rate_limited", b.why === "global" ? "The leaderboard is getting too many password tries today. Phones already unlocked still work; try again tomorrow, or pair this phone's AI first." : "Too many tries. Try again later.", 429);
  }
  if (!(await safeEqual(body.password.trim(), env.LB_PASSWORD.trim()))) {
    try { await backoffFail(db, key, t); } catch {}
    return err("bad_code", "That password didn't work.", 403);
  }
  try { await backoffUntake(db, key, global?.k ?? null); } catch {}
  // cap new tokens per IP / device per day (a right password can't mint unlimited tokens)
  if (!(await take(db, randomToken("t_"), [{ k: `lbm:${key}:${p.day}`, limit: LB_LIMITS.tokensPerKeyPerDay, ttlSec: 2 * 86400 }], t))) return err("rate_limited", "Too many unlocks from this network today. Try again tomorrow.", 429);
  const token = randomToken("lb_");
  await db.batch([
    db.prepare(`DELETE FROM lbtokens WHERE exp <= ?1`).bind(t),
    db.prepare(`INSERT INTO lbtokens (h, uid, un, at, exp, pw, seen) VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?2)`).bind(await sha256Hex(token), t, t + LB_LIMITS.tokenTtlMs, await pwGen(env)),
  ]);
  return json({ token });
}

/** P2-1: the FIRST live token to claim a uid wins. Another phone needs a one-time link code from a phone already linked
 * to that uid. Both paths are single atomic statements/batches, so two phones racing for one uid can't both win. */
async function join(req: Request, env: Env, db: D1Database, t: Tok, now: Date): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (typeof body.uid !== "string" || !UID.test(body.uid) || !okUn(body.un)) return err("bad_request", "Send {uid, un}.", 400);
  if (t.uid === body.uid) return json({ ok: true, uid: body.uid });
  if (t.uid) return err("forbidden", "This phone is already linked to a different Sleeper account. Forget the password and unlock again to switch.", 403);
  const ms = now.getTime(), gen = await pwGen(env), un = body.un.trim();
  if (body.link !== undefined) {
    const code = normLink(body.link);
    if (!code) return err("bad_request", "That link code doesn't look right.", 400);
    const p = localParts(now, cfg(env).tz);
    // count the try BEFORE checking the code (60-bit codes, 10 minutes, 5 tries an hour per token)
    if (!(await take(db, randomToken("t_"), [{ k: `lbl:${t.h}:${p.hour}`, limit: LB_LIMITS.linkTriesPerTokenPerHour, ttlSec: 3600 }], ms))) return err("rate_limited", "Too many link-code tries. Try again later.", 429);
    const ch = await sha256Hex("gg-lb-link/v1\n" + code);
    // ONE batch: the phone cap is checked in the same statement that binds (several codes made while the uid had room
    // can't push it past phonesPerUid when redeemed together); an unused code survives a "full" refusal.
    const r = await db.batch([
      db.prepare(`UPDATE lbtokens SET uid = ?2, un = ?3 WHERE h = ?1 AND uid IS NULL AND EXISTS (SELECT 1 FROM lblink WHERE h = ?4 AND uid = ?2 AND exp > ?5)
        AND (SELECT COUNT(*) FROM lbtokens WHERE uid = ?2 AND exp > ?5 AND pw = ?6) < ?7`).bind(t.h, body.uid, un, ch, ms, gen, LB_LIMITS.phonesPerUid),
      db.prepare(`DELETE FROM lblink WHERE (h = ?1 AND EXISTS (SELECT 1 FROM lbtokens WHERE h = ?2 AND uid = ?3)) OR exp <= ?4`).bind(ch, t.h, body.uid, ms),
      db.prepare(`SELECT (SELECT uid FROM lbtokens WHERE h = ?1) AS uid, EXISTS (SELECT 1 FROM lblink WHERE h = ?2 AND uid = ?3 AND exp > ?4) AS live`).bind(t.h, ch, body.uid, ms),
    ]);
    const row: any = r[2]?.results?.[0];
    if (row?.uid === body.uid) return json({ ok: true, uid: body.uid });
    if (Number(row?.live) === 1) return err("device_limit", `Already ${LB_LIMITS.phonesPerUid} phones on this account. Forget the password on an old phone first.`, 409);
    return err("bad_code", "That link code didn't work. Make a new one on your other phone.", 403);
  }
  const r: any = await db.prepare(`UPDATE lbtokens SET uid = ?2, un = ?3 WHERE h = ?1 AND uid IS NULL
    AND NOT EXISTS (SELECT 1 FROM lbtokens WHERE uid = ?2 AND h <> ?1 AND exp > ?4 AND pw = ?5) RETURNING uid`).bind(t.h, body.uid, un, ms, gen).first();
  if (!r || r.uid !== body.uid) return err("uid_taken", "This Sleeper account is already linked on another phone. On that phone, tap \"Add a phone\" on the leaderboard and enter the code here.", 409);
  return json({ ok: true, uid: body.uid });
}

/** P2-1: a linked phone makes a one-time code (10 minutes) so ONE more phone can join the same uid. */
async function link(env: Env, db: D1Database, t: Tok, now: Date): Promise<Response> {
  if (!t.uid) return err("forbidden", "Join the leaderboard first.", 403);
  const ms = now.getTime(), p = localParts(now, cfg(env).tz);
  if (!(await take(db, randomToken("t_"), [{ k: `lblm:${t.h}:${p.hour}`, limit: LB_LIMITS.linkMakesPerTokenPerHour, ttlSec: 3600 }], ms))) return err("rate_limited", "Too many link codes. Try again later.", 429);
  const n: any = await db.prepare(`SELECT COUNT(*) AS n FROM lbtokens WHERE uid = ?1 AND exp > ?2 AND pw = ?3`).bind(t.uid, ms, await pwGen(env)).first();
  if (Number(n?.n) >= LB_LIMITS.phonesPerUid) return err("device_limit", `Already ${LB_LIMITS.phonesPerUid} phones on this account. Forget the password on an old phone first.`, 409);
  const code = newLink();
  await db.batch([
    db.prepare(`DELETE FROM lblink WHERE by = ?1 OR exp <= ?2`).bind(t.h, ms),
    db.prepare(`INSERT INTO lblink (h, uid, by, exp) VALUES (?1, ?2, ?3, ?4)`).bind(await sha256Hex("gg-lb-link/v1\n" + code), t.uid, t.h, ms + LB_LIMITS.linkTtlMs),
  ]);
  return json({ code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`, expiresInSec: LB_LIMITS.linkTtlMs / 1000 });
}

/** P2-3: "Forget the password" also kills the token (and any link code it made) on the server. */
async function logout(db: D1Database, t: Tok): Promise<Response> {
  await db.batch([db.prepare(`DELETE FROM lblink WHERE by = ?1`).bind(t.h), db.prepare(`DELETE FROM lbtokens WHERE h = ?1`).bind(t.h)]);
  return json({ ok: true });
}

async function snap(req: Request, env: Env, db: D1Database, t: Tok, now: Date): Promise<Response> {
  if (!t.uid) return err("forbidden", "Join the leaderboard first.", 403);
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (body.uid !== undefined && body.uid !== t.uid) return err("forbidden", "You can only share your own picks.", 403);
  const season = Number(body.season), week = Number(body.week);
  const c = cleanPicks(body.picks, body.bf);
  if (!Number.isInteger(season) || season < 2000 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 22 || !c) return err("bad_request", "Bad snapshot.", 400);
  const un = okUn(body.un) ? String(body.un).trim().slice(0, 40) : t.un || "player";
  const idem = typeof body.key === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(body.key) ? body.key : (req.headers.get("idempotency-key") || "");
  const p = localParts(now, cfg(env).tz);
  if (!(await take(db, randomToken("t_"), [{ k: `lbw:${t.h}:${p.hour}`, limit: LB_LIMITS.writesPerTokenPerHour, ttlSec: 3600 }], now.getTime()))) return err("rate_limited", "Too many updates. Try again later.", 429);
  if (un !== t.un) await db.prepare(`UPDATE lbtokens SET un = ?2 WHERE h = ?1`).bind(t.h, un).run();
  const data = { uid: t.uid, un, ...(okAv(body.av) ? { av: body.av } : {}), season, week, picks: c.picks, bf: c.bf, ts: Number(body.ts) || now.getTime(), app: "gg" };
  const r = await fetch(`${HN}/${env.LB_SITE_SLUG}/data/${env.LB_LIVE}`, {
    method: "POST", headers: hnHeaders(env, /^[A-Za-z0-9_-]{8,100}$/.test(idem) ? { "idempotency-key": idem } : {}), body: JSON.stringify(data),
  }).catch(() => null);
  if (!r) return err("upstream", "Couldn't reach the leaderboard store.", 502);
  if (r.status === 429) return err("rate_limited", "The leaderboard store is busy. Try again later.", 429);
  if (!r.ok) return err("upstream", "The leaderboard store refused the update.", 502);
  snapMemo = null;
  return json({ ok: true }, 201);
}

async function snaps(req: Request, env: Env, db: D1Database, t: Tok, now: Date): Promise<Response> {
  const season = Number(new URL(req.url).searchParams.get("season"));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return err("bad_request", "Add ?season=YYYY.", 400);
  const p = localParts(now, cfg(env).tz);
  if (!(await take(db, randomToken("t_"), [{ k: `lbr:${t.h}:${p.hour}`, limit: LB_LIMITS.readsPerTokenPerHour, ttlSec: 3600 }], now.getTime()))) return err("rate_limited", "Too many refreshes. Try again later.", 429);
  let all: Snap[];
  try { all = (await allSnaps(env, now.getTime())).filter((s) => s.season === season); } catch { return err("upstream", "Couldn't reach the leaderboard store.", 502); }
  return json({ records: await hideBeforeKickoff(all, t.uid, now.getTime()) });
}

export async function lbRoute(req: Request, env: Env, now: Date, path: string): Promise<Response> {
  const db = env.GG_DB;
  if (!env.LB_PASSWORD || !env.LB_LIVE || !env.LB_ARCHIVE || !env.LB_SITE_SLUG || !env.HERENOW_API_KEY) return notReady();
  if (!(await lbNamesOk(env))) return notReady(); // C1: random collection names only (fail closed)
  if (!db) return dbDown();
  try { await ensureSchema(db); } catch { return dbDown(); }
  if (req.method === "POST" && path === "/lb/unlock") return unlock(req, env, db, now);
  const routes: Record<string, (t: Tok) => Promise<Response>> = {
    "POST /lb/join": (t) => join(req, env, db, t, now),
    "POST /lb/link": (t) => link(env, db, t, now),
    "POST /lb/logout": (t) => logout(db, t),
    "POST /lb/snap": (t) => snap(req, env, db, t, now),
    "GET /lb/snaps": (t) => snaps(req, env, db, t, now),
  };
  const f = routes[`${req.method} ${path}`];
  if (!f) return err("not_found", "Not found.", 404);
  let t: Tok | Response;
  try { t = await authLb(req, env, db, now.getTime()); } catch { return dbDown(); }
  return t instanceof Response ? t : f(t);
}
