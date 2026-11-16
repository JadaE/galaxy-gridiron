// JC-34 round 2: Security Lead conditions C1, P2-1, P2-2, P2-3, P3-6 (security-lead/reviews/gg-jc34.md). Mock names/ids only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handle, sha256Hex, CORS_ALLOW_METHODS, LIMITS, type Env } from "../src/index";
import default_ from "../src/index";
import { _resetSchemaCache } from "../src/caps";
import { _resetLbMemo, LB_LIMITS, ipBucket, lbNamesOk, normLink } from "../src/lb";
import { FakeD1 } from "./fakeD1";

class MemKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async list({ prefix = "" }: { prefix?: string } = {}) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const NOW = new Date("2026-10-21T14:00:00Z");
const H = 3600_000, D = 24 * H;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MOCK_PW = "mock-family-pass-123";
const MOCK_LIVE = "ggmocklive00000000000000000000000000000001", MOCK_ARCH = "ggmockarchive000000000000000000000000000002";
let kv: MemKV, d1: FakeD1, env: Env, hnCalls: number;
const LIM0 = { ...LB_LIMITS }, PLIM0 = { ...LIMITS };

function req(method: string, path: string, body?: unknown, o: { token?: string; ip?: string; device?: string } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": o.ip ?? "10.0.0.1" };
  if (o.token) h.authorization = `Bearer ${o.token}`;
  if (o.device) h["x-gg-device"] = o.device;
  return new Request(`https://gg.example.workers.dev${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const unlock = (pw: string, ip = "10.0.0.9", when = NOW, device?: string) => handle(req("POST", "/lb/unlock", { password: pw }, { ip, device }), env, when);
async function token(ip = "10.0.0.50", when = NOW, device?: string) {
  const r = await unlock(MOCK_PW, ip, when, device); expect(r.status).toBe(200); return ((await r.json()) as any).token as string;
}
const join = (t: string, uid: string, extra: object = {}, when = NOW) => handle(req("POST", "/lb/join", { uid, un: "mockuser" + uid, ...extra }, { token: t }), env, when);
const snaps = (t: string, when = NOW) => handle(req("GET", "/lb/snaps?season=2026", undefined, { token: t }), env, when);
const mkLink = async (t: string, when = NOW) => { const r = await handle(req("POST", "/lb/link", {}, { token: t }), env, when); return { r, code: r.status === 200 ? ((await r.json()) as any).code as string : "" }; };
const derived = async (pw: string) => "gg" + (await sha256Hex("galaxy-gridiron/leaderboard/v1\n" + pw)).slice(0, 40);
async function pairDevice(name = "Mock Phone") {
  const r = await handle(req("POST", "/pair", { code: "mock-pair-code", deviceName: name }, { ip: "10.9.9.9" }), env, NOW);
  return ((await r.json()) as any).deviceToken as string;
}

beforeEach(() => {
  kv = new MemKV(); d1 = new FakeD1(); _resetSchemaCache(); _resetLbMemo(); hnCalls = 0;
  Object.assign(LB_LIMITS, LIM0); Object.assign(LIMITS, PLIM0);
  env = {
    GG_KV: kv as unknown as KVNamespace, GG_DB: d1, OPENAI_API_KEY: "test-not-a-real-key", PAIRING_CODE: "mock-pair-code",
    LB_PASSWORD: MOCK_PW, LB_LIVE: MOCK_LIVE, LB_ARCHIVE: MOCK_ARCH, LB_SITE_SLUG: "mock-site-0000", HERENOW_API_KEY: "test-not-a-real-hn-key",
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.startsWith("https://here.now/")) { hnCalls++; return new Response(JSON.stringify({ records: [] }), { status: 200 }); }
    if (url.startsWith("https://site.api.espn.com/")) return new Response(JSON.stringify({ events: [] }));
    throw new Error("unexpected fetch " + url);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); Object.assign(LB_LIMITS, LIM0); Object.assign(LIMITS, PLIM0); });

describe("C1: random collection names only (never password-derived)", () => {
  it("refuses to serve (503, no here.now call) when LB_LIVE or LB_ARCHIVE is the old password-derived name", async () => {
    const old = await derived(MOCK_PW);
    for (const [live, arch] of [[old, MOCK_ARCH], [MOCK_LIVE, old + "_a"], [old, old + "_a"]]) {
      env.LB_LIVE = live; env.LB_ARCHIVE = arch;
      const r = await unlock(MOCK_PW);
      expect(r.status).toBe(503);
      expect(((await r.json()) as any).error).toBe("not_configured");
    }
    expect(hnCalls).toBe(0);
    expect(d1.batches).toBe(0); // refused before any limiter work
  });
  it("refuses short / missing / live+'_a' archive names; accepts two independent random names", async () => {
    for (const [live, arch] of [["ggshort", MOCK_ARCH], [MOCK_LIVE, undefined], [MOCK_LIVE, MOCK_LIVE + "_a"], [MOCK_LIVE, MOCK_LIVE]] as const) {
      env.LB_LIVE = live; env.LB_ARCHIVE = arch as any;
      expect(await lbNamesOk(env)).toBe(false);
      expect((await unlock(MOCK_PW)).status).toBe(503);
    }
    env.LB_LIVE = MOCK_LIVE; env.LB_ARCHIVE = MOCK_ARCH;
    expect(await lbNamesOk(env)).toBe(true);
    expect((await unlock(MOCK_PW)).status).toBe(200);
  });
});

describe("P2-1: first uid binding wins; more phones only with a link code", () => {
  it("a second token can't bind a uid that's already bound (409 uid_taken), so it can't write as that uid", async () => {
    const a = await token(), b = await token("10.0.0.51");
    expect((await join(a, "1001")).status).toBe(200);
    expect((await join(a, "1001")).status).toBe(200); // same phone again: fine
    const r = await join(b, "1001");
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error).toBe("uid_taken");
    const w = await handle(req("POST", "/lb/snap", { season: 2026, week: 7, picks: { "4010001": "KC" }, bf: {}, ts: 1, uid: "1001" }, { token: b }), env, NOW);
    expect(w.status).toBe(403);
    expect(hnCalls).toBe(0);
  });
  it("10 tokens racing to bind one uid: exactly one wins", async () => {
    const ts = [] as string[];
    for (let i = 0; i < 10; i++) ts.push(await token(`10.0.1.${i}`));
    const st = (await Promise.all(ts.map((t) => join(t, "1001")))).map((r) => r.status);
    expect(st.filter((s) => s === 200)).toHaveLength(1);
    expect(st.filter((s) => s === 409)).toHaveLength(9);
  });
  it("a link code from the linked phone lets ONE more phone join; single use; 10 minutes; bound to that uid; only its hash stored", async () => {
    const a = await token(), b = await token("10.0.0.51"), c = await token("10.0.0.52"), e = await token("10.0.0.53");
    expect((await mkLink(a)).r.status).toBe(403); // not joined yet: no code
    await join(a, "1001");
    const { r, code } = await mkLink(a);
    expect(r.status).toBe(200);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(JSON.stringify(d1.db.prepare("SELECT * FROM lblink").all())).not.toContain(code.replace(/-/g, ""));
    expect((await join(b, "1002", { link: code })).status).toBe(403); // the code is for 1001 only
    expect((await join(b, "1001", { link: code.toLowerCase() })).status).toBe(200);
    expect((await join(c, "1001", { link: code })).status).toBe(403); // used
    const { code: late } = await mkLink(a);
    expect((await join(e, "1001", { link: late }, at(11 * 60_000))).status).toBe(403); // expired
    expect(normLink("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normLink("short")).toBeNull();
  });
  it("wrong link codes are counted before the check: 5 an hour per token, then 429", async () => {
    const a = await token(), b = await token("10.0.0.51");
    await join(a, "1001");
    const { code } = await mkLink(a);
    for (let i = 0; i < 5; i++) expect((await join(b, "1001", { link: "0000-0000-000" + i })).status).toBe(403);
    expect((await join(b, "1001", { link: code })).status).toBe(429);
  });
  it("the 5-phone cap is also enforced when codes are REDEEMED (atomically): two codes made at 4 phones -> only one more joins", async () => {
    const a = await token(); await join(a, "1001");
    const b = await token("10.0.3.1"); { const { code } = await mkLink(a); expect((await join(b, "1001", { link: code })).status).toBe(200); }
    for (let i = 0; i < 2; i++) { const t = await token(`10.0.3.${i + 2}`); const { code } = await mkLink(a); expect((await join(t, "1001", { link: code })).status).toBe(200); }
    // 4 phones now: two linked phones each make a code while there's still room for one more
    const c1 = (await mkLink(a)).code, c2 = (await mkLink(b)).code;
    expect(c1 && c2).toBeTruthy();
    const x = await token("10.0.4.1"), y = await token("10.0.4.2");
    const st = (await Promise.all([join(x, "1001", { link: c1 }), join(y, "1001", { link: c2 })])).map((r) => r.status).sort();
    expect(st).toEqual([200, 409]);
    expect(d1.q("SELECT COUNT(*) AS n FROM lbtokens WHERE uid = '1001'").n).toBe(5);
  });
  it("at most 5 live phones per uid", async () => {
    const a = await token(); await join(a, "1001");
    for (let i = 0; i < 4; i++) { const t = await token(`10.0.2.${i}`); const { code } = await mkLink(a); expect((await join(t, "1001", { link: code })).status).toBe(200); }
    const r = (await mkLink(a)).r;
    expect(r.status).toBe(409);
  });
});

describe("P2-2: per-IP backoff + soft global trip + paired-device bypass (no global hard lockout)", () => {
  it("one IP: 5 tries, then locked 1h; then 5 more, locked 2h (doubling); a correct password after the lock works", async () => {
    for (let i = 0; i < 5; i++) expect((await unlock("nope" + i)).status).toBe(403);
    expect((await unlock(MOCK_PW, "10.0.0.9", at(30 * 60_000))).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await unlock("nope" + i, "10.0.0.9", at(H + 1000))).status).toBe(403);
    expect((await unlock(MOCK_PW, "10.0.0.9", at(2 * H + 2000))).status).toBe(429); // 2h lockout, not 1h
    expect((await unlock(MOCK_PW, "10.0.0.9", at(3 * H + 2000))).status).toBe(200);
  });
  it("lockouts double 1h, 2h, 4h ... and cap at 24 hours", async () => {
    let t = 0; const locks: number[] = [];
    for (let round = 0; round < 7; round++) {
      for (let i = 0; i < 5; i++) expect((await unlock("nope", "10.0.0.9", at(t))).status).toBe(403);
      const until = d1.q("SELECT until FROM lbback").until;
      locks.push((until - (NOW.getTime() + t)) / H);
      t = until - NOW.getTime() + 1000;
    }
    expect(locks).toEqual([1, 2, 4, 8, 16, 24, 24]);
  });
  it("30 parallel wrong guesses from one IP still count only 5", async () => {
    const st = (await Promise.all(Array.from({ length: 30 }, (_, i) => unlock("g" + i)))).map((r) => r.status);
    expect(st.filter((s) => s === 403)).toHaveLength(5);
  });
  it("IPv6 is bucketed by /64", async () => {
    expect(ipBucket("2001:db8:1:2::a")).toBe(ipBucket("2001:0db8:0001:0002:ffff:1:2:3"));
    expect(ipBucket("2001:db8:1:3::a")).not.toBe(ipBucket("2001:db8:1:2::a"));
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("10.0.0.1")).toBe("10.0.0.1");
    for (let i = 0; i < 5; i++) await unlock("nope", `2001:db8:1:2::${i + 1}`);
    expect((await unlock(MOCK_PW, "2001:db8:1:2:abcd::9")).status).toBe(429);
    expect((await unlock(MOCK_PW, "2001:db8:1:3::1")).status).toBe(200);
  });
  it("strangers can't lock everyone out: the old 20/day hard lock is gone; past the soft ceiling only paired phones unlock, an alert is raised, and existing tokens keep working", async () => {
    const existing = await token("10.5.0.1");
    LB_LIMITS.unlockSoftGlobalPerDay = 30;
    await Promise.all(Array.from({ length: 6 }, (_, ip) => Promise.all(Array.from({ length: 5 }, () => unlock("nope", `10.6.0.${ip}`)))));
    const r = await unlock(MOCK_PW, "10.7.0.1");
    expect(r.status).toBe(429);
    expect(d1.q("SELECT n FROM lbalert WHERE k = 'global:2026-10-21'").n).toBeGreaterThanOrEqual(1);
    const dev = await pairDevice();
    expect((await unlock(MOCK_PW, "10.7.0.1", NOW, dev)).status).toBe(200); // paired phone: counted per device
    expect((await unlock(MOCK_PW, "10.7.0.1", NOW, "gg_not-a-real-device-token-0000000")).status).toBe(429); // fake device = stranger
    expect((await snaps(existing)).status).toBe(200);
    expect((await unlock(MOCK_PW, "10.7.0.1", at(D))).status).toBe(200); // next day
  });
  it("20 wrong tries spread across IPs (the old global limit) don't block a family member", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => unlock("nope", `10.2.0.${i}`)));
    expect((await unlock(MOCK_PW, "10.3.0.1")).status).toBe(200);
  });
  it("paired devices get their own backoff (5 wrong -> that device is locked, another device is not)", async () => {
    const d1v = await pairDevice("A"), d2v = await pairDevice("B");
    for (let i = 0; i < 5; i++) expect((await unlock("nope", "10.8.0.1", NOW, d1v)).status).toBe(403);
    expect((await unlock(MOCK_PW, "10.8.0.2", NOW, d1v)).status).toBe(429);
    expect((await unlock(MOCK_PW, "10.8.0.1", NOW, d2v)).status).toBe(200);
  });
  it("a correct password can't mint unlimited tokens: 10 per IP per day", async () => {
    for (let i = 0; i < 10; i++) await token("10.0.0.77");
    expect((await unlock(MOCK_PW, "10.0.0.77")).status).toBe(429);
  });
});

describe("/pair: per-network backoff + soft global trip (Security Lead extra; replaces the 20/day lockout)", () => {
  const pr = (code: string, ip: string, when = NOW) => handle(req("POST", "/pair", { code, deviceName: "Mock" }, { ip }), env, when);
  it("one IP: 5 wrong codes -> locked 1h, then 2h (doubling); other IPs unaffected", async () => {
    for (let i = 0; i < 5; i++) expect((await pr("nope", "10.0.0.9")).status).toBe(403);
    expect((await pr("mock-pair-code", "10.0.0.9", at(30 * 60_000))).status).toBe(429);
    expect((await pr("mock-pair-code", "10.0.0.10")).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await pr("nope", "10.0.0.9", at(H + 1000))).status).toBe(403);
    expect((await pr("mock-pair-code", "10.0.0.9", at(2 * H + 2000))).status).toBe(429);
    expect((await pr("mock-pair-code", "10.0.0.9", at(3 * H + 2000))).status).toBe(200);
  });
  it("30 parallel wrong codes from one IP count only 5; IPv6 shares a /64", async () => {
    const st = (await Promise.all(Array.from({ length: 30 }, () => pr("nope", "2001:db8:5:6::1")))).map((r) => r.status);
    expect(st.filter((s) => s === 403)).toHaveLength(5);
    expect((await pr("mock-pair-code", "2001:db8:5:6::99")).status).toBe(429);
  });
  it("past the soft global ceiling: 429 plus an owner alert; the next day pairing works again", async () => {
    LIMITS.pairSoftGlobalPerDay = 12;
    await Promise.all(Array.from({ length: 3 }, (_, ip) => Promise.all(Array.from({ length: 5 }, () => pr("nope", `10.6.1.${ip}`)))));
    expect((await pr("mock-pair-code", "10.7.1.1")).status).toBe(429);
    expect(d1.q("SELECT n FROM lbalert WHERE k = 'pair-global:2026-10-21'").n).toBeGreaterThanOrEqual(1);
    expect((await pr("mock-pair-code", "10.7.1.1", at(D))).status).toBe(200);
  });
  it("D1 down -> 503 and the code is never compared", async () => {
    d1.down = true;
    expect((await pr("mock-pair-code", "10.0.0.1")).status).toBe(503);
    expect(kv.store.size).toBe(0);
  });
});

describe("P2-3: token expiry and revocation", () => {
  it("expires after 180 days unused (and the row is deleted); use slides the expiry", async () => {
    const a = await token(), b = await token("10.0.0.51");
    expect((await snaps(a, at(100 * D))).status).toBe(200); // slides a to day 280
    expect((await snaps(a, at(250 * D))).status).toBe(200);
    expect((await snaps(b, at(181 * D))).status).toBe(401);
    expect(d1.q("SELECT COUNT(*) AS n FROM lbtokens WHERE h = ?", await sha256Hex(b)).n).toBe(0);
  });
  it("an expired binding frees the uid for a new phone", async () => {
    const a = await token(); await join(a, "1001");
    const b = await token("10.0.0.51", at(181 * D));
    expect((await join(b, "1001", {}, at(181 * D))).status).toBe(200);
  });
  it("rotating LB_PASSWORD revokes every token (and frees uids); stored generation is a short tag, not the password hash", async () => {
    const a = await token(); await join(a, "1001");
    const row: any = d1.q("SELECT pw FROM lbtokens");
    expect(row.pw).toHaveLength(8);
    expect(await sha256Hex(MOCK_PW)).not.toContain(row.pw);
    env.LB_PASSWORD = "mock-new-family-pass-456";
    expect((await snaps(a)).status).toBe(401);
    const b = await unlock("mock-new-family-pass-456", "10.0.0.51");
    const tb = ((await b.json()) as any).token;
    expect((await join(tb, "1001")).status).toBe(200);
  });
  it("POST /lb/logout revokes this phone's token on the server", async () => {
    const a = await token();
    expect((await handle(req("POST", "/lb/logout", {}, { token: a }), env, NOW)).status).toBe(200);
    expect((await snaps(a)).status).toBe(401);
  });
});

describe("P3-6: CORS preflight allows only the methods the Worker serves", () => {
  const pre = (m = "POST") => default_.fetch(new Request("https://gg.example.workers.dev/lb/snap", { method: "OPTIONS", headers: { origin: "https://mock-site-0000.here.now", "access-control-request-method": m } }), { ...env, ALLOWED_ORIGINS: "https://mock-site-0000.here.now" } as Env);
  it("GET, POST, OPTIONS only (no DELETE/PUT/PATCH)", async () => {
    const m = ((await pre()).headers.get("access-control-allow-methods") || "").split(",").map((x) => x.trim());
    expect(m).toEqual(["GET", "POST", "OPTIONS"]);
    expect(CORS_ALLOW_METHODS).not.toMatch(/DELETE|PUT|PATCH/);
  });
  it("every method a route uses is allowed, and nothing more", () => {
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/lb.ts", import.meta.url), "utf8");
    const used = new Set([...src.matchAll(/req\.method === "([A-Z]+)"/g), ...src.matchAll(/"([A-Z]+) \/lb\//g)].map((x) => x[1]));
    expect([...used].sort()).toEqual(["GET", "OPTIONS", "POST"]);
  });
  it("a DELETE to any route is a 404, not served", async () => {
    expect((await handle(req("DELETE", "/lb/snap"), env, NOW)).status).toBe(404);
  });
});
