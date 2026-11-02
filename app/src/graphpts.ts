// v0.0.12: pure helpers for the leaderboard's running win % graph (tested in tests/v012.test.ts).
/** Segments between consecutive points that have values. gap = there were empty weeks in between (drawn dashed). */
export function lineSegments(values: (number | null)[]): { from: number; to: number; gap: boolean }[] {
  const idx = values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0);
  return idx.slice(1).map((to, j) => ({ from: idx[j], to, gap: to - idx[j] > 1 }));
}
/** Running win % per played week, but null for weeks where that person has no decided picks (no carried-forward value). */
export function runningPctPoints(rows: { week: number; rec: { w: number; l: number }; cumPct?: number | null }[], played: number[]): (number | null)[] {
  return played.map(w => { const r = rows.find(x => x.week === w); return r && r.rec.w + r.rec.l > 0 ? r.cumPct ?? null : null; });
}
