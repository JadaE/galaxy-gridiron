// JC-109: trade chips on the same here.now Site Data path as picks (fam.live).
// Records use typ:'tags' so pick resolve() ignores them. Same family key, Origin, and Idempotency-Key.
// No new collection. Without the family password, chips stay on the phone.
import { familyLiveUrl, FLUSH_TIMEOUT_MS, hasFamilyKey, SITE } from '../picks/sync';
import { Chip, ChipState, markUploaded, tagKv, validChipId, validLeagueId } from './store';

const APP = 'gg';
export const TAGS_TYP = 'tags';

export type TagSnap = { id: string; uid: string; un: string; league: string; tags: Record<string, Chip>; at: Record<string, number>; ts: number; createdAt: number };
export type QueuedTag = { uid: string; un: string; av?: string; league: string; tags: Record<string, Chip>; at: Record<string, number>; ts: number; key: string };


function fetchWithTimeout(fetcher: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  const aborted = new Promise<never>((_, rej) => {
    const fail = () => { const e = new Error('timeout'); e.name = 'AbortError'; rej(e); };
    if (ac.signal.aborted) fail();
    else ac.signal.addEventListener('abort', fail, { once: true });
  });
  const prev = init.signal;
  if (prev) {
    if (prev.aborted) ac.abort();
    else prev.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return Promise.race([Promise.resolve(fetcher(url, { ...init, signal: ac.signal })), aborted]).finally(() => clearTimeout(t));
}

export function snapshotTags(me: { uid: string; un: string; av?: string }, league: string, s: ChipState): QueuedTag {
  return { uid: me.uid, un: me.un, av: me.av, league, tags: { ...s.tags }, at: { ...s.at }, ts: s.ts || Date.now(), key: `${me.uid}-${league}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}

const QK = 'tags:queue';
async function getQueue(): Promise<QueuedTag[]> { try { return JSON.parse((await tagKv.get(QK)) || '[]'); } catch { return []; } }
async function setQueue(q: QueuedTag[]) { await tagKv.set(QK, JSON.stringify(q)); }

export async function enqueueTags(s: QueuedTag) {
  const q = (await getQueue()).filter(x => !(x.uid === s.uid && x.league === s.league));
  q.push(s); await setQueue(q);
}
export async function pendingTagCount() { return (await getQueue()).length; }

let flushing = false;
export async function flushTags(fetcher: typeof fetch = fetch, opts?: { timeoutMs?: number }): Promise<{ sent: number; left: number; error?: string }> {
  const url = familyLiveUrl();
  if (flushing || !url) return { sent: 0, left: (await getQueue()).length };
  flushing = true;
  const timeoutMs = opts?.timeoutMs ?? FLUSH_TIMEOUT_MS;
  let sent = 0, error: string | undefined;
  try {
    let q = await getQueue();
    while (q.length) {
      const s = q[0];
      const cur = (await getQueue()).find(x => x.uid === s.uid && x.league === s.league);
      if (!cur || cur.key !== s.key) { q = await getQueue(); continue; }
      let r: Response;
      try {
        r = await fetchWithTimeout(fetcher, url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', Origin: SITE, 'Idempotency-Key': s.key },
          // Must omit season, week and picks. Shipped v0.0.12 / v0.0.14 clients do not check typ;
          // a padded empty-picks record could look like a complete week and clear on-time picks.
          body: JSON.stringify({ app: APP, typ: TAGS_TYP, uid: s.uid, un: s.un, av: s.av || undefined, league: s.league, tags: s.tags, at: s.at, ts: s.ts }),
        }, timeoutMs);
      } catch (e: any) {
        error = (e?.name === 'AbortError' || /timeout/i.test(String(e?.message || e))) ? 'timeout' : 'offline';
        break;
      }
      if (r.status === 429) { error = 'busy (rate limited), will retry'; break; }
      if (!r.ok && r.status >= 500) { error = 'server error ' + r.status; break; }
      // 4xx other than 429, including 401: drop this snapshot. 401 does not change the family key.
      if (!r.ok) error = 'rejected ' + r.status;
      else {
        sent++;
        await markUploaded(s.uid, s.league, { tags: s.tags, at: s.at, ts: s.ts });
      }
      q = (await getQueue()).filter(x => x.key !== s.key);
      await setQueue(q);
    }
    return { sent, left: q.length, error };
  } finally { flushing = false; }
}

export function cleanTag(r: any): TagSnap | null {
  const d = r?.data;
  const at = Date.parse(r?.createdAt);
  if (!d || !Number.isFinite(at) || d.app !== APP || d.typ !== TAGS_TYP) return null;
  if (typeof d.uid !== 'string' || !/^\d{1,24}$/.test(d.uid) || typeof d.un !== 'string' || d.un.startsWith('_')) return null;
  if (typeof d.league !== 'string' || !validLeagueId(d.league)) return null;
  const tags: Record<string, Chip> = {}, times: Record<string, number> = {};
  for (const [id, t] of Object.entries<any>(d.tags || {})) if (validChipId(id) && (t === 'never' || t === 'high')) tags[id] = t;
  for (const [id, n] of Object.entries<any>(d.at || {})) if (validChipId(id) && Number.isFinite(n) && n > 0) times[id] = Number(n);
  return { id: String(r.id), uid: d.uid, un: d.un.slice(0, 40), league: d.league, tags, at: times, ts: Number(d.ts) || 0, createdAt: at };
}

/** Read typ:'tags' snapshots from the live family collection (paged). */
export async function fetchTagSnaps(fetcher: typeof fetch = fetch): Promise<TagSnap[]> {
  const url = familyLiveUrl();
  if (!url) throw new Error('locked');
  const out: TagSnap[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const r = await fetcher(`${url}?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j: any = await r.json();
    for (const x of j.records || []) { const s = cleanTag(x); if (s) out.push(s); }
    cursor = j.nextCursor || null;
  } while (cursor && ++pages < 60);
  return out;
}

export { hasFamilyKey };
