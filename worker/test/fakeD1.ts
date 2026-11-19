// Test-only fake of the D1 interface (caps.ts), backed by an in-memory SQLite (node:sqlite). Like D1, each batch()
// runs as one transaction and calls are async with a random delay, so concurrent requests really interleave.
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/caps";

const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
export class FakeD1 implements D1Database {
  db = new DatabaseSync(":memory:");
  batches = 0;
  down = false;
  prepare(sql: string): D1PreparedStatement {
    const self = this;
    const mk = (args: unknown[]): D1PreparedStatement & { _exec(): D1Result } => ({
      bind: (...v: unknown[]) => mk(v),
      _exec() {
        const st = self.db.prepare(sql);
        if (/^\s*(SELECT|.*RETURNING)/is.test(sql)) return { results: st.all(...(args as any[])) as any[] };
        const r = st.run(...(args as any[]));
        return { results: [], meta: { changes: Number(r.changes) } };
      },
      async first<T>() { await self.gate(); const x = (this as any)._exec().results?.[0]; return (x ?? null) as T | null; },
      async run() { await self.gate(); return (this as any)._exec(); },
    });
    return mk([]);
  }
  async gate() { await tick(); if (this.down) throw new Error("D1_ERROR: unavailable"); }
  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    await this.gate();
    this.batches++;
    this.db.exec("BEGIN");
    try { const out = stmts.map((s) => (s as any)._exec()); this.db.exec("COMMIT"); return out; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  /** test helper: read a value */
  q(sql: string, ...a: any[]) { return this.db.prepare(sql).get(...a) as any; }
}
