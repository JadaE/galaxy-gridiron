// JC-40: atomic AI caps (D1). Concurrent requests must not exceed the cap. Mock names/ids only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, sha256Hex, type Env } from "../src/index";
import { _resetSchemaCache, ensureSchema, reserve, finalize, release as releaseRes } from "../src/caps";
import { FakeD1 } from "./fakeD1";

class MemKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async list({ prefix = "" }: { prefix?: string } = {}) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const NOW = new Date("2026-10-21T14:00:00Z");
let kv: MemKV, d1: FakeD1, env: Env, openai: number, upstreamMode: "ok" | "500" | "net" | "hang";
let releaseHang: (() => void) | null;

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

beforeEach(() => {
  kv = new MemKV(); d1 = new FakeD1(); _resetSchemaCache();
  openai = 0; upstreamMode = "ok"; releaseHang = null;
  env = {
    GG_KV: kv as unknown as KVNamespace, GG_DB: d1, OPENAI_API_KEY: "test-not-a-real-key", PAIRING_CODE: "mock-pair-code",
    MONTH_CAP_USD: "5", DAILY_LIMIT: "30",
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.startsWith("https://api.openai.com/")) {
      openai++;
      await sleep(5);
      if (upstreamMode === "hang") await new Promise<void>((r) => (releaseHang = r));
      if (upstreamMode === "net") throw new Error("boom");
      if (upstreamMode === "500") return new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 500 });
      return new Response(JSON.stringify({ output_text: "Start the mock.", usage: { input_tokens: 300, output_tokens: 400 } }), { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("JC-40 atomic AI caps (D1)", () => {
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
    const ts = await Promise.all([pair("Mock Phone A"), pair("Mock Phone B"), pair("Mock Phone C"), pair("Mock Phone D")]);
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
    while (!releaseHang) await sleep(1);
    const mid = (await (await handle(req("GET", "/usage", undefined, t), env, NOW)).json()) as any;
    expect(mid.dailyCount).toBe(1);
    expect(mid.monthSpendUsd).toBeGreaterThan(0.00035); // worst case reserved (>= 700 max output tokens)
    releaseHang!();
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

describe("caps rely on D1 batch() as one transaction", () => {
  const A = { id: "r1", dev: "mockdev", day: "2026-10-21", month: "2026-10", micros: 1000, dailyLimit: 30, capMicros: 5_000_000, now: NOW.getTime() };
  it("reserve/finalize/release each make exactly ONE D1 call (one batch, no reads or writes outside it)", async () => {
    await ensureSchema(d1);
    const gate = vi.spyOn(d1, "gate");
    const one = async (f: () => Promise<unknown>) => { gate.mockClear(); const b = d1.batches; await f(); expect(d1.batches - b).toBe(1); expect(gate).toHaveBeenCalledTimes(1); };
    await one(() => reserve(d1, A));
    await one(() => finalize(d1, "r1", 500));
    await one(() => reserve(d1, { ...A, id: "r2" }));
    await one(() => releaseRes(d1, "r2"));
  });
  it("a statement failing mid-batch rolls the whole reserve back (no partial daily/spend count)", async () => {
    await ensureSchema(d1);
    await reserve(d1, A); // creates the rows: daily 1, spend 1000
    const before = { n: d1.q("SELECT n FROM daily").n };
    const prep = d1.db.prepare.bind(d1.db);
    (d1.db as any).prepare = (sql: string) => { if (/^\s*UPDATE spend SET micros = micros \+/.test(sql)) throw new Error("mock failure"); return prep(sql); };
    await expect(reserve(d1, { ...A, id: "r3" })).rejects.toThrow("mock failure");
    (d1.db as any).prepare = prep;
    expect(d1.q("SELECT n FROM daily").n).toBe(before.n); // the daily +1 earlier in the same batch was rolled back
    expect(d1.q("SELECT micros FROM spend").micros).toBe(1000);
    expect(d1.q("SELECT COUNT(*) AS c FROM res WHERE id = 'r3'").c).toBe(0);
  });
});
