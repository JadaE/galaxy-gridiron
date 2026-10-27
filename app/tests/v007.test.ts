// Run: npx tsx --require ./tests/rn-shim.cjs tests/v007.test.ts  (this-week start/sit, lineup gap + AutoSubs, flex rules)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { optimalLineup, lineupGap, lineupAlerts, Bundle, pron } from '../src/model';
import { parseGames, pointsAllowed, practiceNote } from '../src/gameinfo';
import { leagueScored } from '../src/api';
import { oppQb } from '../src/chat/week';
import { asksFit, lineupReply } from '../src/chat/engine';
import { parseLive, watchUrl, highlightsUrl, watchOptions, sundayAfternoon } from '../src/live';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message, process.env.STACK ? e.stack : ''); } };

// tiny synthetic league: id -> [pos, proj, injury?]
function fake(slots: string[], roster: Record<string, [string, number, string?]>, starters: string[], settings: any = {}): Bundle {
  const players: any = {}, proj: any = {};
  for (const id in roster) { const [p, v, i] = roster[id]; players[id] = { n: 'P' + id, p, t: 'T' + id, i }; proj[id] = [v, v, v, 1]; }
  for (let k = 0; k < 60; k++) proj['x' + k] = [0, 0, 0, 0]; // "projections loaded" guard (> 50 rows)
  const me: any = { rid: 1, players: Object.keys(roster), starters, reserve: [], display: 'me' };
  return { slots, players, proj, si: 0, me, isPast: false, league: { settings }, practice: {}, games: null, allowed: {}, week: 7 } as any;
}

(async () => {
  await t('FLEX takes only RB/WR/TE: a 2nd QB, DEF or K never fills it', () => {
    const b = fake(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'], { q1: ['QB', 25], q2: ['QB', 24], d1: ['DEF', 9], d2: ['DEF', 30], k1: ['K', 8], k2: ['K', 40], r1: ['RB', 10], w1: ['WR', 9], t1: ['TE', 6], r2: ['RB', 3] }, []);
    const opt = optimalLineup(b, b.me.players, id => b.proj[id][0]);
    const at = (s: string) => opt.filter(o => o.slot === s).map(o => o.id);
    assert.deepEqual(at('QB'), ['q1']); assert.deepEqual(at('DEF'), ['d2']); assert.deepEqual(at('K'), ['k2']);
    assert.deepEqual(at('FLEX'), ['r2'], 'FLEX should get the RB, not q2 (24), d1 or k1');
    const ids = opt.map(o => o.id);
    assert.equal(ids.filter(id => b.players[id!].p === 'QB').length, 1); assert.equal(ids.filter(id => b.players[id!].p === 'DEF').length, 1);
  });
  await t('SUPER_FLEX allows a 2nd QB; W/R and W/T flexes keep their positions', () => {
    const b = fake(['QB', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX', 'DEF'], { q1: ['QB', 25], q2: ['QB', 24], t1: ['TE', 12], r1: ['RB', 11], w1: ['WR', 5], d1: ['DEF', 7], d2: ['DEF', 6] }, []);
    const opt = optimalLineup(b, b.me.players, id => b.proj[id][0]);
    const at = (s: string) => opt.find(o => o.slot === s)!.id;
    assert.equal(at('QB'), 'q1'); assert.equal(at('SUPER_FLEX'), 'q2'); assert.equal(at('WRRB_FLEX'), 'r1'); assert.equal(at('REC_FLEX'), 't1'); assert.equal(at('DEF'), 'd1');
  });
  await t('IR-tagged starter with a live projection COUNTS (like Sleeper); best lineup = current, no swap', () => {
    const b = fake(['QB', 'RB', 'RB', 'DEF'], { q1: ['QB', 18.58], q2: ['QB', 18.4], r1: ['RB', 11.8], r2: ['RB', 9.58, 'IR'], r3: ['RB', 7.72], d1: ['DEF', 9.41], d2: ['DEF', 8.82] }, ['q1', 'r1', 'r2', 'd1'], { max_subs: 2 });
    (b as any).practice = { r2: { text: 'full practice Wednesday', full: true, ts: Date.now() } };
    const g = lineupGap(b);
    assert.equal(g.curSum.toFixed(2), '49.37'); assert.equal(g.optSum.toFixed(2), '49.37'); assert.equal(g.swaps.length, 0);
    const a = lineupAlerts(b);
    assert.ok(!a.some(x => x.kind === 'swap'), JSON.stringify(a));
    assert.match(a[0].text, /Pr2 is tagged IR but still projects 9\.6 \(full practice Wednesday\), so he may return this week\. Set an AutoSub in Sleeper \(best: Pr3, 7\.7 proj\)/);
  });
  await t('Out starter with NO projection counts 0 -> one explicit swap that names the best total', () => {
    const b = fake(['QB', 'RB', 'RB'], { q1: ['QB', 18], r1: ['RB', 11], r2: ['RB', 0, 'Out'], r3: ['RB', 7.7] }, ['q1', 'r1', 'r2']);
    const g = lineupGap(b); assert.equal(g.curSum.toFixed(1), '29.0'); assert.equal(g.optSum.toFixed(1), '36.7');
    assert.deepEqual([g.swaps[0].slot, g.swaps[0].out, g.swaps[0].in], ['RB', 'r2', 'r3']);
    const a = lineupAlerts(b);
    assert.equal(a.filter(x => x.kind === 'swap').length, 1, JSON.stringify(a));
    assert.match(a[0].text, /Start Pr3/); assert.match(a[0].text, /best lineup: 36\.7 \(\+7\.7\)/);
  });
  await t('Out starter + AutoSubs on -> "already maxed", keep him in if activated', () => {
    const b = fake(['QB', 'RB', 'RB'], { q1: ['QB', 18], r1: ['RB', 11], r2: ['RB', 0, 'Out'], r3: ['RB', 7.7] }, ['q1', 'r1', 'r2'], { max_subs: 2 });
    const a = lineupAlerts(b);
    assert.match(a[0].text, /If Pr3 \(7\.7 proj\) is your AutoSub for him, you're already maxed \(36\.7\)\. Otherwise swap Pr3 in\. Keep Pr2 in if he's activated\./);
    assert.ok(a.some(x => /2 AutoSubs a week/.test(x.text)));
    assert.ok(!a.some(x => /Best lineup projects/.test(x.text)));
  });
  await t('alerts: a bench player who simply projects higher gets an explicit swap list', () => {
    const b = fake(['QB', 'WR', 'FLEX', 'DEF'], { q1: ['QB', 18], q2: ['QB', 25], w1: ['WR', 5], w2: ['WR', 12], t1: ['TE', 6], d1: ['DEF', 4], d2: ['DEF', 9] }, ['q1', 'w1', 't1', 'd1']);
    const s = lineupAlerts(b).find(x => /Best lineup projects/.test(x.text))!;
    assert.ok(s, 'summary missing');
    assert.match(s.text, /QB: Pq1 → Pq2 \(\+7\.0\)/); assert.match(s.text, /DEF: Pd1 → Pd2 \(\+5\.0\)/); assert.match(s.text, /one player per slot/);
  });
  await t('ESPN week 7 lines -> implied totals (CHI 26.75 vs NE 23.75; NYG 16 at HOU)', () => {
    const g = parseGames(JSON.parse(fs.readFileSync(__dirname + '/fixtures/espn-2026-w7.json', 'utf8')));
    assert.equal(g.CHI.opp, 'NE'); assert.equal(g.CHI.home, true); assert.equal(g.CHI.implied, 26.75); assert.equal(g.NE.implied, 23.75); assert.equal(g.NE.spread, 3);
    assert.equal(g.HOU.oppImplied, 16); assert.equal(g.NYG.home, false); assert.equal(Object.keys(g).length, 28);
    assert.ok(!g.BUF && !g.JAX && !g.LAC && !g.WAS, 'bye teams have no game');
  });
  await t('points allowed by position: averages per game and ranks (1 = allows most)', () => {
    const weeks: any = { 1: { a: [20, 0, 0, 1, null, null, 'X', 30], b: [10, 0, 0, 1, null, null, 'Y', 30] }, 2: { a: [30, 0, 0, 1, null, null, 'X', 30], c: [5, 0, 0, 1, null, null, 'Z', 3] } };
    const opp = { '1:X': 'Y', '1:Y': '@X', '2:X': '@Z', '2:Z': 'X' };
    const al = pointsAllowed(weeks, opp, () => 'QB', 0);
    assert.deepEqual(al.Z.QB, { avg: 30, rank: 1, n: 1 }); assert.deepEqual(al.Y.QB, { avg: 20, rank: 2, n: 1 }); assert.equal(al.X.QB.avg, 10);
    assert.ok(!al.X?.QB || al.X.QB.n === 1); // 5-point, 3-attempt QB skipped
  });
  await t('practice notes from Sleeper news text', () => {
    const now = Date.now(), n = (title: string) => [{ ts: now - 3600_000, src: 'rotowire', title, desc: '' }];
    assert.deepEqual(practiceNote(n('Jordan Mason - Full practice Wednesday, still on IR'), now), { text: 'full practice Wednesday', full: true, ts: now - 3600_000 });
    assert.equal(practiceNote(n('Mike Evans (ribs) doesn\'t practice Wednesday'), now)!.text, 'did not practice Wednesday');
    assert.equal(practiceNote(n('Bowers (hamstring) limited at practice Wednesday'), now)!.text, 'limited practice Wednesday');
    assert.equal(practiceNote([{ ts: now - 9 * 86400_000, src: 'x', title: 'Full practice Wednesday', desc: '' }], now), null);
  });
  await t('"rest of season / fit / keep" asks for roster fit; plain "X or Y?" does not', () => {
    assert.ok(asksFit('Young or Williams rest of season?')); assert.ok(asksFit('who fits my roster better, X or Y')); assert.ok(!asksFit('Should I start Caleb Williams or Bryce Young?')); assert.ok(!asksFit('Vikings or Texans?'));
  });
  await t('team defenses are "it", players "he"', () => { const b = fake(['DEF'], { MIN: ['DEF', 8], p1: ['WR', 3] }, []); assert.equal(pron(b, 'MIN'), 'it'); assert.equal(pron(b, 'p1', true), 'He'); });
  await t('projections use the league scoring (Sleeper matchup method): McPherson 6.91, not PPR 8.27', () => {
    const k = { player_id: '7839', stats: { fgm_20_29: 0.32, fgm_30_39: 0.48, fgm_40_49: 0.48, fgm_50p: 0.27, fgmiss_30_39: 0.05, fgmiss_40_49: 0.05, fgmiss_50p: 0.15, xpm: 2.72, xpmiss: 0.13, pts_ppr: 8.27 } };
    const sc = { fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6, fgmiss: -1, xpm: 1, xpmiss: -1 };
    assert.equal(leagueScored([k], sc)['7839'][0], 6.91);
  });
  await t('opposing QB comes from this week\'s projections, not a stale depth chart (NYG: McCarthy over Winston)', () => {
    const b = fake(['QB'], { w: ['QB', 0], m: ['QB', 13.49] }, []);
    b.players.w.t = 'NYG'; (b.players.w as any).d = 1; b.players.m.t = 'NYG'; (b.players.m as any).d = 3;
    assert.equal(oppQb(b, 'NYG'), 'm');
  });
  await t('Watch: official broadcasters from ESPN broadcasts field, official links only', () => {
    const j = { events: [{ id: '9', date: '2026-10-22T23:15Z', competitions: [{ broadcasts: [{ market: 'national', names: ['Prime Video'] }], geoBroadcasts: [{ media: { shortName: 'Prime Video' } }], status: { type: { state: 'pre' } },
      competitors: [{ homeAway: 'home', score: '0', team: { id: '3', abbreviation: 'CHI' } }, { homeAway: 'away', score: '0', team: { id: '17', abbreviation: 'NE' } }] }] }] };
    const g = parseLive(j).CHI;
    assert.deepEqual(g.tv, ['Prime Video']);
    for (const n of ['CBS', 'Fox', 'NBC', 'Prime Video', 'ESPN', 'ABC', 'NFL Net', 'Disney+']) assert.match(watchUrl(n) || '', /^https:\/\/(www\.|tv\.)?(cbs|foxsports|nbc|amazon|espn|nfl|disneyplus)\.com\//, n);
    assert.equal(watchUrl('SomeRandomStreams'), null);
    const pre = watchOptions(g, 7).map(o => o.label);
    assert.deepEqual(pre, ['Prime Video', 'NFL+', 'YouTube TV'], 'Thursday national game: no Sunday Ticket, no highlights before kickoff');
    const sun = { ...g, tv: ['Fox'], kickoff: Date.parse('2026-10-25T17:00:00Z'), state: 'in' as const };
    assert.ok(sundayAfternoon(sun.kickoff));
    assert.deepEqual(watchOptions(sun, 7).map(o => o.label), ['FOX Sports', 'FOX One', 'NFL+', 'YouTube TV', 'NFL Sunday Ticket', 'Highlights']);
    for (const o of watchOptions(sun, 7)) assert.match(o.url, /^https:\/\/(www|tv)\.(cbs|foxsports|foxone|nfl|youtube|paramountplus|nbc|peacocktv|amazon|espn|disneyplus|netflix)\.com\//);
    assert.match(highlightsUrl(g, 7), /^https:\/\/www\.youtube\.com\/@NFL\/search\?query=NE%20vs%20CHI/);
  });
  await t('v0.0.8: generic "who should I start?" uses this week\'s Sleeper projections (HOU 9.33 > MIN 8.83 even if MIN has more season value), 1 QB/1 DEF, coin flip < 1 pt', () => {
    const b = fake(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      { by: ['QB', 18.6], cw: ['QB', 18.4], MIN: ['DEF', 8.83], HOU: ['DEF', 9.33], r1: ['RB', 12], r2: ['RB', 7.7], w1: ['WR', 16], t1: ['TE', 9], k1: ['K', 7], mason: ['RB', 9.58, 'IR'] },
      ['by', 'r1', 'w1', 't1', 'mason', 'k1', 'MIN']);
    b.players.by.n = 'Bryce Young'; b.players.cw.n = 'Caleb Williams'; b.players.MIN.n = 'Minnesota Vikings'; b.players.HOU.n = 'Houston Texans'; b.players.mason.n = 'Jordan Mason'; b.players.r2.n = 'Emanuel Wilson';
    (b as any).weekly = { 7: [] }; (b as any).byRid = {};
    (b as any).valuer = { get: (id: string) => ({ value: id === 'MIN' ? 30 : 5, floor: id === 'MIN' ? 10 : 1, median: 5 }) }; // season value favors MIN: must be ignored this week
    const r = lineupReply(b);
    const [head] = r.text.split('\n');
    assert.match(head, /within a point of your best lineup/, head);
    assert.doesNotMatch(r.text, /start Minnesota Vikings/i);
    assert.match(r.text, /Houston Texans 9\.3 vs Minnesota Vikings 8\.8 is basically a coin flip.*My pick: Houston Texans/);
    const best = r.text.split('Best lineup')[1];
    assert.match(best, /DEF: Houston Texans/); assert.doesNotMatch(best, /Minnesota Vikings/);
    assert.equal((best.match(/^QB: /gm) || []).length, 1); assert.doesNotMatch(best, /FLEX: (Caleb|Bryce|Houston|Minnesota)/);
    assert.match(best, /FLEX: Jordan Mason \(9\.6\)/, 'IR player with a live projection counts, like Sleeper');
    assert.match(r.text, /Bryce Young 18\.6 vs Caleb Williams 18\.4 is basically a coin flip/);
    assert.match(r.text, /Projected: 81\.0 as set, 81\.5 with the change \(sum of starters/);
    // a real gap (>= 1 pt): headline names the swap, and it's the same one the lineup shows
    b.proj.HOU = [10.5, 10.5, 10.5, 1];
    const r2 = lineupReply(b);
    assert.match(r2.text.split('\n')[0], /start Houston Texans \(10\.5\) over Minnesota Vikings \(8\.8\) at DEF \(\+1\.7\)/);
    assert.match(r2.text, /DEF: Houston Texans \(10\.5\)/);
  });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
