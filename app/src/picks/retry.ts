// JC-38 / JC-60: retry pending pick uploads on launch, resume, and a timer, with backoff.
// Sends still go through flush() on the existing here.now Site Data path. No auth or password changes.
import { AppState, AppStateStatus } from 'react-native';
import { flush, hasFamilyKey, pendingCount, setFamilyKey } from './sync';
import { validKey } from './family';

export const SYNC_INTERVAL_MS = 3 * 60_000;
export const BACKOFF_START_MS = 30_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

let failCount = 0;
let nextAllowedAt = 0;

export function _resetRetryState() { failCount = 0; nextAllowedAt = 0; }

export function backoffMs(fails: number): number {
  if (fails <= 0) return 0;
  return Math.min(BACKOFF_START_MS * (2 ** (fails - 1)), BACKOFF_MAX_MS);
}

export function canAutoFlush(now = Date.now()): boolean { return now >= nextAllowedAt; }

export type SyncReason = 'launch' | 'resume' | 'timer' | 'manual';

function isRetryable(error?: string): boolean {
  if (!error) return false;
  return error === 'timeout' || error === 'offline' || error.startsWith('busy') || error.startsWith('server error');
}

export async function runPickSync(reason: SyncReason, fetcher: typeof fetch = fetch, now = Date.now(), timeoutMs?: number): Promise<{ sent: number; left: number; error?: string }> {
  if (!hasFamilyKey()) return { sent: 0, left: await pendingCount() };
  if (reason !== 'manual' && reason !== 'launch' && !canAutoFlush(now)) {
    return { sent: 0, left: await pendingCount(), error: 'backoff' };
  }
  const r = await flush(fetcher, timeoutMs != null ? { timeoutMs } : undefined);
  if (r.skipped) return r;
  if (isRetryable(r.error) && r.left > 0) {
    failCount += 1;
    nextAllowedAt = now + backoffMs(failCount);
  } else if (!r.error || (r.error.startsWith('rejected') && r.left === 0)) {
    failCount = 0;
    nextAllowedAt = 0;
  }
  return r;
}

export async function ensureFamilyKey(getKey: () => Promise<string | null>): Promise<boolean> {
  if (hasFamilyKey()) return true;
  try {
    const k = JSON.parse((await getKey()) || 'null');
    if (validKey(k)) { setFamilyKey(k); return true; }
  } catch {}
  return false;
}

export type PickSyncHooks = {
  getKey: () => Promise<string | null>;
  intervalMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  addAppStateListener?: (cb: (state: string) => void) => () => void;
  setIntervalFn?: (fn: () => void, ms: number) => () => void;
  onTick?: (reason: SyncReason) => void;
};

/** Start launch + resume + interval retries. Returns stop() (and ready, the launch attempt). */
export function startPickSync(hooks: PickSyncHooks): { stop: () => void; ready: Promise<void> } {
  let stopped = false;
  const now = hooks.now || Date.now;
  const tick = async (reason: SyncReason) => {
    if (stopped) return;
    hooks.onTick?.(reason);
    await ensureFamilyKey(hooks.getKey);
    if (!hasFamilyKey()) return;
    await runPickSync(reason, hooks.fetcher, now());
  };
  const ready = tick('launch');
  const clearIv = (hooks.setIntervalFn || ((fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }))(() => { void tick('timer'); }, hooks.intervalMs ?? SYNC_INTERVAL_MS);
  const add = hooks.addAppStateListener || ((cb) => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => { if (s === 'active') cb(s); });
    return () => sub.remove();
  });
  const unsub = add((s) => { if (s === 'active') void tick('resume'); });
  return {
    stop() { stopped = true; clearIv(); unsub(); },
    ready,
  };
}
