// v0.0.6: in-app feedback -> append-only here.now Site Data collection (insert public, read owner only; no keys in the app).
// Read submissions on the box with tools/feedback-inbox.sh. Nothing submitted there is acted on automatically.
import { Platform } from 'react-native';
import { VERSION_NAME, VERSION_CODE } from './version';
import { SITE } from './picks/sync';
import { FEEDBACK_COLLECTION_ID } from './config';

export const FEEDBACK_COLLECTION = FEEDBACK_COLLECTION_ID;
const URL_ = `${SITE}/.herenow/data/${FEEDBACK_COLLECTION}`;
export type FeedbackKind = 'bug' | 'idea';
export type Feedback = { kind: FeedbackKind; text: string; screen?: string; user?: string };

export function deviceInfo(): string {
  if (Platform.OS === 'web') {
    const ua = (globalThis as any).navigator?.userAgent || '';
    const standalone = (globalThis as any).navigator?.standalone || (globalThis as any).matchMedia?.('(display-mode: standalone)')?.matches;
    return `web${standalone ? ' (home screen)' : ''} · ${ua}`.slice(0, 200);
  }
  const c: any = (Platform as any).constants || {};
  return `${Platform.OS} ${c.Release || Platform.Version}${c.Manufacturer ? ' · ' + c.Manufacturer : ''}${c.Model ? ' ' + c.Model : ''}`.slice(0, 200);
}

export function buildRecord(f: Feedback) {
  const text = f.text.trim().slice(0, 1000);
  if (text.length < 3) throw new Error('Write a few words first.');
  return { kind: f.kind === 'idea' ? 'idea' : 'bug', text, screen: (f.screen || '').slice(0, 40) || undefined, user: (f.user || '').slice(0, 40) || undefined,
    app: `${VERSION_NAME} (${VERSION_CODE})${Platform.OS === 'web' ? ' web' : ''}`, device: deviceInfo(), ts: Date.now() };
}

export async function sendFeedback(f: Feedback, fetcher: typeof fetch = fetch): Promise<void> {
  const rec = buildRecord(f);
  let r: Response;
  try {
    r = await fetcher(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...(Platform.OS === 'web' ? {} : { Origin: SITE }), 'Idempotency-Key': `fb-${rec.ts}-${rec.text.length}` }, body: JSON.stringify(rec) });
  } catch { throw new Error("You're offline. Try again when you have signal."); }
  if (r.status === 429) throw new Error('Too many sends from this network this hour. Try again later.');
  if (!r.ok) throw new Error(`Couldn't send (error ${r.status}).`);
}
