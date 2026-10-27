// "Update available" check. Reads version.json from the app's stable, unguessable update channel on here.now
// (same site as the download pages; nothing secret here beyond the link itself). GET only.
import { Platform, Linking } from 'react-native';
import { VERSION_CODE } from './version';
import { saveSetting, loadSetting, HOUR } from './api';
import { isHostedPwa, PWA_BASE } from './web';

export const UPDATE_URL = 'https://YOUR-SITE-SLUG.here.now/YOUR_UPDATE_CHANNEL_PATH/version.json';
const SITE = 'https://YOUR-SITE-SLUG.here.now/';
export type UpdateInfo = { versionCode: number; versionName: string; apkUrl: string; notes: string };
// web screenshots only: ?updurl=<local json> overrides the channel
const qpUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('updurl') : null;

function valid(j: any): UpdateInfo | null {
  if (!j || !Number.isInteger(j.versionCode) || typeof j.apkUrl !== 'string' || typeof j.versionName !== 'string') return null;
  if (!j.apkUrl.startsWith(SITE) && !(qpUrl && j.apkUrl.startsWith('http://localhost'))) return null; // only ever open our own download site
  return { versionCode: j.versionCode, versionName: j.versionName.slice(0, 20), apkUrl: j.apkUrl, notes: String(j.notes || '').slice(0, 400) };
}

/** Returns the newer release if one exists, else null. Throttled to once per 6h unless force. Throws only when force. */
export async function checkForUpdate(force = false): Promise<{ info: UpdateInfo | null; latest: UpdateInfo | null; checkedAt: number }> {
  const last = Number((await loadSetting('upd:lastCheck')) || 0);
  if (!force && Date.now() - last < (isHostedPwa() ? HOUR : 6 * HOUR)) {
    let c: UpdateInfo | null = null;
    try { c = valid(JSON.parse((await loadSetting('upd:latest')) || 'null')); } catch {}
    return { info: c && c.versionCode > VERSION_CODE ? c : null, latest: c, checkedAt: last };
  }
  try {
    // iPhone web app: its own same-site channel; "update" = reload the page
    const chan = qpUrl || (isHostedPwa() ? `${PWA_BASE}/pwa-version.json` : UPDATE_URL);
    const r = await fetch(chan + '?t=' + Date.now(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = valid(await r.json());
    if (!j) throw new Error('Bad version file');
    const now = Date.now();
    await saveSetting('upd:lastCheck', String(now)); await saveSetting('upd:latest', JSON.stringify(j));
    return { info: j.versionCode > VERSION_CODE ? j : null, latest: j, checkedAt: now };
  } catch (e) {
    if (force) throw e;
    return { info: null, latest: null, checkedAt: last };
  }
}
export const isWebApp = () => Platform.OS === 'web' && isHostedPwa();
export const openDownload = (u: UpdateInfo) => {
  if (isWebApp()) { try { (window as any).location.replace(window.location.pathname + '?v=' + u.versionCode); } catch { (window as any).location.reload(); } return; }
  Linking.openURL(u.apkUrl);
};
export async function dismissed() { return Number((await loadSetting('upd:dismissed')) || 0); }
export async function dismiss(code: number) { await saveSetting('upd:dismissed', String(code)); }
