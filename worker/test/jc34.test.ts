// JC-34: atomic AI caps (D1, P1-1) and the server-side leaderboard gate (P1-2). Mock names/ids only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, sha256Hex, type Env } from "../src/index";
import { _resetSchemaCache } from "../src/caps";
import { _resetLbMemo, cleanRecord } from "../src/lb";
import { FakeD1 } from "./fakeD1";

class MemKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async list({ prefix = "" }: { prefix?: string } = {}) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const NOW = new Date("2026-10-21T14:00:00Z");
const MOCK_PW = "mock-family-pass-123";
const MOCK_LIVE = "ggmocklivecollection", MOCK_ARCH = "ggmocklivecollection_a";
let kv: MemKV, d1: FakeD1, env: Env, openai: number, hnRecords: any[], hnPosts: any[], upstreamMode: "ok" | "500" | "net" | "hang";
let release: (() => void) | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function req(method: string, path: string, body?: unknown, token?: string, ip = "10.0.0.1") {
  const h: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://gg.example.workers.dev${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const chatBody = { tier: "budget", messages: [{ role: "user", content: "Mock QB or Mock WR?" }], context: { team: "Mock League Alpha" } };
async function pair(name = "Mock Phone") {
  const r = await handle(req("POST", "/pair", { code: "mock-pair-code", deviceName: name }), env, NOW);
  return ((await r.json()) as any).deviceToken as string;
}
const KICK = { early: NOW.getTime() - 3600_000, late: NOW.getTime() + 3600_000 };

beforeEach(() => {
  kv = new MemKV(); d1 = new FakeD1(); _resetSchemaCache(); _resetLbMemo();
  openai = 0; hnRecords = []; hnPosts = []; upstreamMode = "ok"; release = null;
  env = {
    GG_KV: kv as unknown as KVNamespace, GG_DB: d1, OPENAI_API_KEY: "test-not-a-real-key", PAIRING_CODE: "mock-pair-code",
    MONTH_CAP_USD: "5", DAILY_LIMIT: "30",
    LB_PASSWORD: MOCK_PW, LB_LIVE: MOCK_LIVE, LB_ARCHIVE: MOCK_ARCH, LB_SITE_SLUG: "mock-site-0000", HERENOW_API_KEY: "test-not-a-real-hn-key",
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    if (url.startsWith("https://api.openai.com/")) {
      openai++;
      await sleep(5);
      if (upstreamMode === "hang") await new Promise<void>((r) => (release = r));
      if (upstreamMode === "net") throw new Error("boom");
      if (upstreamMode === "500") return new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 500 });
      return new Response(JSON.stringify({ output_text: "Start the mock.", usage: { input_tokens: 300, output_tokens: 400 } }), { status: 200 });
    }
    if (url.startsWith("https://here.now/api/v1/publishes/mock-site-0000/data/")) {
      expect((init?.headers as any).authorization).toBe("Bearer test-not-a-real-hn-key");
      const coll = url.split("/data/")[1].split("?")[0];
      if (init?.method === "POST") { const data = JSON.parse(String(init.body)); hnPosts.push(data); hnRecords.push({ id: "r" + hnRecords.length, coll, data, createdAt: NOW.toISOString() }); return new Response("{}", { status: 201 }); }
      return new Response(JSON.stringify({ records: hnRecords.filter((r) => r.coll === coll) }), { status: 200 });
    }
    if (url.startsWith("https://site.api.espn.com/")) {
      return new Response(JSON.stringify({ events: [{ id: "4010001", date: new Date(KICK.early).toISOString() }, { id: "4010002", date: new Date(KICK.late).toISOString() }] }));
    }
    throw new Error("unexpected fetch " + url);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("P1-1 atomic AI caps (D1)", () => {
  it("20 concurrent /chat at DAILY_LIMIT-1 -> exactly one OpenAI call, the rest daily_limit", async () => {
    const t = await pair();
    kv.store.set(`daily:${await sha256Hex(t)}:2026-10-21`, "29"); // carried over from the old KV counter
    const rs = await Promise.all(Array.from({ length: 20 }, () => handle(req("POST", "/chat", chatBody, t), env, NOW)));
    const codes = await Promise.all(rs.map(async (r) => (r.status === 200 ? "ok" : ((await r.json()) as any).error)));
    expect(openai).toBe(1);
    expect(codes.filter((c) => c === "ok")).toHaveLength(1);
    expect(codes.filter((c) => c === "daily_limit")).toHaveLength(19);
    const u = (await (await handle(req("GET", "/usage", undefined, t), env, NOW)).json()) as any;
    expect(u.dailyCount).toBe(30);
  });

  it("20 concurrent /chat one worst case under the cap -> at most one OpenAI call, spend never above the cap", async () => {
    env.MONTH_CAP_USD = "0.001";
    kv.store.set("spend:2026-10", "0.0005"); // room for ~one worst-case budget question
    const ts = await Promise.all([pair("a"), pair("b"), pair("c"), pair("d")]);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => handle(req("POST", "/chat", chatBody, ts[i % 4]), env, NOW)));
    const ok = rs.filter((r) => r.status === 200).length;
    expect(openai).toBeLessThanOrEqual(1);
    expect(ok).toBe(openai);
    const u = (await (await handle(req("GET", "/usage", undefined, ts[0]), env, NOW)).json()) as any;
    expect(u.monthSpendUsd).toBeLessThanOrEqual(0.001);
    expect(d1.q("SELECT COUNT(*) AS n FROM res").n).toBe(0); // every reservation settled
  });

  for (const mode of ["500", "net"] as const) {
    it(`upstream ${mode} -> release ran: daily and month counters back to the pre-call values, OpenAI called once`, async () => {
      const t = await pair();
      kv.store.set("spend:2026-10", "0.25");
      const before = (await (await handle(req("GET", "/usage", undefined, t), env, NOW)).json()) as any;
      upstreamMode = mode;
      const r = await handle(req("POST", "/chat", chatBody, t), env, NOW);
      expect(r.status).toBe(502);
      expect(((await r.json()) as any)).toMatchObject({ error: "upstream", dailyCount: before.dailyCount, monthSpendUsd: before.monthSpendUsd });
      expect(openai).toBe(1);
      expect((await (await handle(req("GET", "/usage", undefined, t), env, NOW)).json())).toEqual(before);
    });
  }

  it("/usage counts in-flight reservations (can't look under the cap mid-flight); success bills the actual cost", async () => {
    const t = await pair();
    upstreamMode = "hang";
    const p = handle(req("POST", "/chat", chatBody, t), env, NOW);
    while (!release) await sleep(1);
    const mid = (await (await handle(req("GET", "/usage", undefined, t), env, NOW)).json()) as any;
    expect(mid.dailyCount).toBe(1);
    expect(mid.monthSpendUsd).toBeGreaterThan(0.00035); // worst case reserved (>= 700 max output tokens)
    release!();
    const b = (await (await p).json()) as any;
    expect(b).toMatchObject({ reply: "Start the mock.", costUsd: 0.00023, monthSpendUsd: 0.00023, dailyCount: 1 });
  });

  it("caps store down or missing -> 503, zero OpenAI calls (no KV fallback)", async () => {
    const t = await pair();
    d1.down = true;
    const r = await handle(req("POST", "/chat", chatBody, t), env, NOW);
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error).toBe("unavailable");
    delete env.GG_DB;
    expect((await handle(req("POST", "/chat", chatBody, t), env, NOW)).status).toBe(503);
    expect((await handle(req("GET", "/usage", undefined, t), env, NOW)).status).toBe(503);
    expect(openai).toBe(0);
  });
});

describe("P1-2 leaderboard: server-side unlock, lockout, lb_ token, uid binding, pre-kickoff hide", () => {
  const unlock = (pw: string, ip = "10.0.0.9", at = NOW) => handle(req("POST", "/lb/unlock", { password: pw }, undefined, ip), env, at);
  async function token(ip = "10.0.0.50") { const r = await unlock(MOCK_PW, ip); expect(r.status).toBe(200); return ((await r.json()) as any).token as string; }
  const noSecrets = (s: string) => { for (const v of [MOCK_PW, MOCK_LIVE, "test-not-a-real-hn-key"]) expect(s).not.toContain(v); };

  it("30 parallel wrong passwords from one IP -> 5 counted attempts, then 429; right password still 429 until the window ends", async () => {
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => unlock("wrong-guess-" + i)));
    const st = rs.map((r) => r.status);
    expect(st.filter((s) => s === 403)).toHaveLength(5);
    expect(st.filter((s) => s === 429)).toHaveLength(25);
    expect((await unlock(MOCK_PW)).status).toBe(429);
    const later = await unlock(MOCK_PW, "10.0.0.9", new Date(NOW.getTime() + 3600_000));
    expect(later.status).toBe(200);
    const txt = await later.text();
    noSecrets(txt);
    expect(Object.keys(JSON.parse(txt))).toEqual(["token"]);
    expect(JSON.parse(txt).token).toMatch(/^lb_[A-Za-z0-9_-]{40,}$/);
    // only a hash of the token is stored
    expect(JSON.stringify(d1.db.prepare("SELECT * FROM lbtok").all())).not.toContain(JSON.parse(txt).token);
  });

  it("global lockout after 20 wrong passwords a day across IPs; a correct unlock doesn't use up attempts", async () => {
    for (let i = 0; i < 4; i++) await token("10.1.0.1"); // 4 good unlocks from one IP: still allowed
    expect((await unlock(MOCK_PW, "10.1.0.1")).status).toBe(200);
    await Promise.all(Array.from({ length: 20 }, (_, i) => unlock("nope", `10.2.0.${i}`)));
    expect((await unlock(MOCK_PW, "10.3.0.1")).status).toBe(429);
  });

  it("wrong and malformed answers never reveal anything; not configured -> 503", async () => {
    const r = await unlock("not-it");
    expect(r.status).toBe(403);
    noSecrets(await r.text());
    delete env.LB_PASSWORD;
    expect((await unlock(MOCK_PW)).status).toBe(503);
  });

  it("writes need a token and a bound uid; another uid -> 403; stored records only carry the bound uid", async () => {
    const snap = { season: 2026, week: 7, picks: { "4010001": "KC", "4010002": "BUF" }, bf: {}, ts: 1 };
    expect((await handle(req("POST", "/lb/snap", snap), env, NOW)).status).toBe(401);
    const t = await token();
    expect((await handle(req("POST", "/lb/snap", snap, t), env, NOW)).status).toBe(403); // not joined yet
    expect((await handle(req("POST", "/lb/join", { uid: "1001", un: "mockusera" }, t), env, NOW)).status).toBe(200);
    expect((await handle(req("POST", "/lb/join", { uid: "1002", un: "mockuserb" }, t), env, NOW)).status).toBe(403);
    expect((await handle(req("POST", "/lb/snap", { ...snap, uid: "1002", un: "mockuserb" }, t), env, NOW)).status).toBe(403);
    expect((await handle(req("POST", "/lb/snap", { ...snap, un: "mockusera2" }, t), env, NOW)).status).toBe(201);
    expect(hnPosts).toHaveLength(1);
    expect(hnPosts[0]).toMatchObject({ uid: "1001", un: "mockusera2", app: "gg", season: 2026, week: 7 });
  });

  it("GET /lb/snaps hides other people's picks until the Worker's kickoff time; own picks always visible", async () => {
    const mk = (uid: string, un: string) => ({ id: "x" + uid, coll: MOCK_LIVE, createdAt: new Date(NOW.getTime() - 7200_000).toISOString(), data: { uid, un, season: 2026, week: 7, picks: { "4010001": "KC", "4010002": "BUF", "4019999": "DAL" }, bf: {}, ts: 1, app: "gg" } });
    hnRecords.push(mk("1001", "mockusera"), mk("1002", "mockuserb"));
    const t = await token();
    await handle(req("POST", "/lb/join", { uid: "1001", un: "mockusera" }, t), env, NOW);
    const r = await handle(req("GET", "/lb/snaps?season=2026", undefined, t), env, NOW);
    const txt = await r.text(); noSecrets(txt);
    const recs = JSON.parse(txt).records as any[];
    expect(recs.find((x) => x.uid === "1001").picks).toEqual({ "4010001": "KC", "4010002": "BUF", "4019999": "DAL" });
    expect(recs.find((x) => x.uid === "1002").picks).toEqual({ "4010001": "KC" }); // started; 4010002 not yet; unknown game hidden
    _resetLbMemo();
    const after = (await (await handle(req("GET", "/lb/snaps?season=2026", undefined, t), env, new Date(KICK.late + 1))).json()) as any;
    expect(after.records.find((x: any) => x.uid === "1002").picks).toEqual({ "4010001": "KC", "4010002": "BUF" });
    // a token that never joined sees nobody's pre-kickoff picks
    const t2 = await token("10.0.0.51");
    const anon = (await (await handle(req("GET", "/lb/snaps?season=2026", undefined, t2), env, NOW)).json()) as any;
    for (const x of anon.records) expect(Object.keys(x.picks)).toEqual(["4010001"]);
  });

  it("`oc` (original time) is trusted only from the owner archive, never from the live collection", () => {
    const r = { id: "a1", createdAt: "2026-10-21T14:00:00Z", data: { uid: "1001", un: "mockusera", season: 2026, week: 7, picks: { "4010001": "KC" }, bf: {}, ts: 0, app: "gg", oc: 1000 } };
    expect(cleanRecord(r, false)!.createdAt).toBe(Date.parse(r.createdAt));
    expect(cleanRecord(r, true)!.createdAt).toBe(1000);
    expect(cleanRecord({ ...r, data: { ...r.data, un: "_hidden" } }, false)).toBeNull();
  });

  it("leaderboard routes fail closed when D1 is down", async () => {
    d1.down = true;
    expect((await unlock(MOCK_PW)).status).toBe(503);
  });
});
