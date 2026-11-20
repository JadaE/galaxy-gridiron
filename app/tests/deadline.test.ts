// JC-113: trade-deadline status. Deterministic mock leagues only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/deadline.test.ts
import assert from 'node:assert/strict';
import { tradeDeadlineWeek, tradeDeadlineStatus, deadlineSubtitle, deadlineMessage, deadlineWeekFinished } from '../src/deadline';

let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

const b = (week: number, deadline: unknown, games?: Record<string, { state: string }> | null) => ({
  week,
  league: { league_id: 'mock-league-a', settings: deadline === undefined ? {} : { trade_deadline: deadline } },
  games: games ?? null,
});

(async () => {
  console.log('Trade deadline (JC-113)');

  await t('before the deadline week: open, no warning, trades stay active', () => {
    const x = b(8, 11);
    assert.equal(tradeDeadlineWeek(x), 11);
    assert.equal(tradeDeadlineStatus(x), 'open');
    assert.equal(deadlineMessage('open', 11, 8), '');
    assert.equal(deadlineSubtitle('open', 11), 'Trade deadline: week 11');
  });

  await t('the week before the deadline: approaching warning, trades still active', () => {
    const x = b(10, 11);
    assert.equal(tradeDeadlineStatus(x), 'approaching');
    assert.match(deadlineMessage('approaching', 11, 10), /next week \(week 11\)/);
    assert.equal(deadlineSubtitle('approaching', 11), 'Trade deadline: week 11');
  });

  await t('deadline week: warning shown, trades still active until games finish', () => {
    const mid = b(11, 11, { CHI: { state: 'post' }, DET: { state: 'in' } });
    assert.equal(tradeDeadlineStatus(mid), 'approaching');
    assert.match(deadlineMessage('approaching', 11, 11), /deadline week \(week 11\)/);
    assert.match(deadlineMessage('approaching', 11, 11), /lock when the last game ends/);
    const noGames = b(11, 11, null);
    assert.equal(tradeDeadlineStatus(noGames), 'approaching');
  });

  await t('past the deadline week: trades are closed', () => {
    const x = b(12, 11);
    assert.equal(tradeDeadlineStatus(x), 'closed');
    assert.match(deadlineMessage('closed', 11, 12), /Trades are closed for this league/);
    assert.match(deadlineMessage('closed', 11, 12), /week 11/);
    assert.equal(deadlineSubtitle('closed', 11), 'Trade deadline passed (week 11)');
  });

  await t('deadline week after the last game is final: closed', () => {
    const x = b(11, 11, { CHI: { state: 'post' }, DET: { state: 'post' } });
    assert.equal(deadlineWeekFinished(x.games), true);
    assert.equal(tradeDeadlineStatus(x), 'closed');
  });

  await t('no deadline (0, 99, undefined) stays open with no warning', () => {
    for (const raw of [0, 99, undefined, null, '', 'off']) {
      const x = b(14, raw as any);
      assert.equal(tradeDeadlineWeek(x), null, String(raw));
      assert.equal(tradeDeadlineStatus(x), 'none', String(raw));
      assert.equal(deadlineSubtitle('none', null), 'No trade deadline');
    }
    const missing = { week: 14, league: { settings: {} } };
    assert.equal(tradeDeadlineStatus(missing), 'none');
  });

  await t('switching leagues updates status from the new league settings immediately', () => {
    const first = { week: 12, league: { league_id: 'mock-league-a', settings: { trade_deadline: 11 } } };
    const second = { week: 12, league: { league_id: 'mock-league-b', settings: { trade_deadline: 99 } } };
    const third = { week: 12, league: { league_id: 'mock-league-c', settings: { trade_deadline: 14 } } };
    assert.equal(tradeDeadlineStatus(first), 'closed');
    assert.equal(tradeDeadlineStatus(second), 'none');
    assert.equal(tradeDeadlineStatus(third), 'open');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
