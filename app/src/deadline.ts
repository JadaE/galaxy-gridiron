/** Sleeper stores settings.trade_deadline as an NFL week number. Trading stays open through every
 * game of that week and closes when the last game ends (Sleeper Support). 0 or a missing value
 * means the commissioner turned the deadline off; 99 is the usual "no deadline" sentinel. */
export type DeadlineStatus = 'none' | 'open' | 'approaching' | 'closed';

export type DeadlineBundle = {
  week: number;
  league?: { settings?: { trade_deadline?: unknown } };
  games?: Record<string, { state: string }> | null;
};

/** Real deadline week, or null when the league has no deadline. */
export function tradeDeadlineWeek(b: DeadlineBundle): number | null {
  const n = Number(b.league?.settings?.trade_deadline);
  if (!Number.isFinite(n) || n <= 0 || n >= 99) return null;
  return n;
}

/** True when every loaded game for the current week is over. If games are missing we do not guess. */
export function deadlineWeekFinished(games?: Record<string, { state: string }> | null): boolean {
  if (!games) return false;
  const list = Object.values(games);
  return list.length > 0 && list.every(g => g.state === 'post');
}

/**
 * none: no deadline set (0, 99, undefined).
 * open: before the week leading up to the deadline.
 * approaching: the week before the deadline, or deadline week while games are still being played.
 * closed: after the deadline week, or deadline week once every loaded game is final.
 */
export function tradeDeadlineStatus(b: DeadlineBundle): DeadlineStatus {
  const d = tradeDeadlineWeek(b);
  if (d == null) return 'none';
  if (b.week > d) return 'closed';
  if (b.week === d && deadlineWeekFinished(b.games)) return 'closed';
  if (b.week >= d - 1) return 'approaching';
  return 'open';
}

export function deadlineSubtitle(status: DeadlineStatus, deadline: number | null): string {
  if (status === 'none' || deadline == null) return 'No trade deadline';
  if (status === 'closed') return `Trade deadline passed (week ${deadline})`;
  return `Trade deadline: week ${deadline}`;
}

export function deadlineMessage(status: DeadlineStatus, deadline: number, week: number): string {
  if (status === 'closed') return `Trades are closed for this league. The trade deadline was week ${deadline}.`;
  if (status === 'approaching' && week === deadline) return `This is the trade deadline week (week ${deadline}). Trades stay open through this week's games and lock when the last game ends.`;
  if (status === 'approaching') return `The trade deadline is next week (week ${deadline}). Trades stay open through week ${deadline}'s games and lock when the last game ends.`;
  return '';
}
