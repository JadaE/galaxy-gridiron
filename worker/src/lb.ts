// JC-34 (audit P1-2): the shared picks leaderboard goes through this Worker instead of straight to here.now Site Data.
//  * POST /lb/unlock {password}  -> server-side, constant-time password check with ATOMIC limits in D1
//    (5 tries per IP per hour, 20 per day for everyone; counted BEFORE the compare). Success returns an `lb_` token
//    (256-bit; only its SHA-256 is stored). Never returns a collection name; wrong/unknown look identical.
//  * POST /lb/join {uid, un}     -> binds the token to one Sleeper user id, once.
//  * POST /lb/snap               -> writes a snapshot AS the bound uid (any other uid in the body = 403).
//  * GET  /lb/snaps?season=YYYY  -> every snapshot for the season, with OTHER people's picks hidden per game until that
//    game's kickoff (kickoffs from ESPN, fetched here; never from the client). The caller's own uid is always shown.
// The Worker is the only reader/writer of the collections (here.now owner API). Collection names, the password and the
// owner key are Worker secrets only, never in the app or this repo.
import { take, untake, ensureSchema, type D1Database } from "./caps";
import { err, json, readJson, sha256Hex, safeEqual, randomToken, localParts, cfg, type Env } from "./index";

export interface LbEnv {
  LB_PASSWORD?: string;   // secret: the shared family password (wrangler secret put LB_PASSWORD)
  LB_LIVE?: string;       // secret: live snapshot collection name
  LB_ARCHIVE?: string;    // secret: archive collection name (optional)
  LB_SITE_SLUG?: string;  // secret or var: here.now site slug
  HERENOW_API_KEY?: string; // secret: here.now owner API key (read + write the collections)
}

export const LB_LIMITS = { unlockPerIpPerHour: 5, unlockGlobalPerDay: 20, writesPerTokenPerHour: 120, readsPerTokenPerHour: 600, maxGames: 40 };
const HN = "https://here.now/api/v1/publishes";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ABBR = /^[A-Z]{2,3}$/, GID = /^\d{4,12}$/, UID = /^\d{1,24}$/;

export type Snap = { id: string; uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; createdAt: number };

type Tok = { h: string; uid: string | null; un: string | null };
async function authLb(req: Request, db: D1Database): Promise<Tok | Response> {
  const m = /^Bearer\s+(lb_\S{20,200})$/i.exec(req.headers.get("authorization") || "");
  if (!m) return err("unpaired", "Unlock the leaderboard with the family password first.", 401);
  const h = await sha256Hex(m[1]);
  const row: any = await db.prepare(`SELECT h, uid, un FROM lbtok WHERE h = ?1`).bind(h).first();
  if (!row) return err("unpaired", "Unlock the leaderboard with the family password first.", 401);
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

// game id -> kickoff (ms), fetched by the Worker from ESPN; cached per isolate for 10 minutes
const kickMemo = new Map<string, { at: number; k: Record<string, number> }>();
async function kickoffs(season: number, week: number, now: number): Promise<Record<string, number>> {
  const key = season + ":" + week, m = kickMemo.get(key);
  if (m && now - m.at < 600_000) return m.k;
  const k: Record<string, number> = {};
  try {
    const r = await fetch(`${ESPN}?week=${week}&seasontype=2&dates=${season}`);
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

async function unlock(req: Request, env: Env, db: D1Database, now: Date): Promise<Response> {
  if (!env.LB_PASSWORD) return notReady();
  const p = localParts(now, cfg(env).tz);
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const keys = [
    { k: `lbu:ip:${await sha256Hex(ip)}:${p.hour}`, limit: LB_LIMITS.unlockPerIpPerHour, ttlSec: 3600 },
    { k: `lbu:all:${p.day}`, limit: LB_LIMITS.unlockGlobalPerDay, ttlSec: 2 * 86400 },
  ];
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 200) return err("bad_request", "Send {password} as a string.", 400);
  // count the attempt BEFORE comparing: parallel guesses can't slip past the limit
  let allowed: boolean;
  try { allowed = await take(db, randomToken("t_"), keys, now.getTime()); } catch { return dbDown(); }
  if (!allowed) return err("rate_limited", "Too many tries. Try again later.", 429);
  if (!(await safeEqual(body.password.trim(), env.LB_PASSWORD.trim()))) return err("bad_code", "That password didn't work.", 403);
  try { await untake(db, keys.map((x) => x.k)); } catch {}
  const token = randomToken("lb_");
  await db.prepare(`INSERT INTO lbtok (h, uid, un, at) VALUES (?1, NULL, NULL, ?2)`).bind(await sha256Hex(token), now.getTime()).run();
  return json({ token });
}

async function join(req: Request, db: D1Database, t: Tok): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  if (typeof body.uid !== "string" || !UID.test(body.uid) || !okUn(body.un)) return err("bad_request", "Send {uid, un}.", 400);
  if (t.uid && t.uid !== body.uid) return err("forbidden", "This phone is already linked to a different Sleeper account. Lock and unlock again to switch.", 403);
  const r: any = await db.prepare(`UPDATE lbtok SET uid = ?2, un = ?3 WHERE h = ?1 AND (uid IS NULL OR uid = ?2) RETURNING uid`).bind(t.h, body.uid, body.un.trim()).first();
  if (!r || r.uid !== body.uid) return err("forbidden", "This phone is already linked to a different Sleeper account.", 403);
  return json({ ok: true, uid: body.uid });
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
  if (un !== t.un) await db.prepare(`UPDATE lbtok SET un = ?2 WHERE h = ?1`).bind(t.h, un).run();
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
  if (!env.LB_PASSWORD || !env.LB_LIVE || !env.LB_SITE_SLUG || !env.HERENOW_API_KEY) return notReady();
  if (!db) return dbDown();
  try { await ensureSchema(db); } catch { return dbDown(); }
  if (req.method === "POST" && path === "/lb/unlock") return unlock(req, env, db, now);
  const routes: Record<string, (t: Tok) => Promise<Response>> = {
    "POST /lb/join": (t) => join(req, db, t),
    "POST /lb/snap": (t) => snap(req, env, db, t, now),
    "GET /lb/snaps": (t) => snaps(req, env, db, t, now),
  };
  const f = routes[`${req.method} ${path}`];
  if (!f) return err("not_found", "Not found.", 404);
  let t: Tok | Response;
  try { t = await authLb(req, db); } catch { return dbDown(); }
  return t instanceof Response ? t : f(t);
}
