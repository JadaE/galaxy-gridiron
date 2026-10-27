// Picks on the phone (AsyncStorage), one record per Sleeper user_id + season, so anyone
// else who launches the app as themselves gets their own record.
import { saveSetting, loadSetting } from '../api';
import { PickMap } from './core';

const key = (uid: string, season: number) => `picks:${uid}:${season}`;
export async function loadPicks(uid: string, season: number): Promise<PickMap> {
  try { return JSON.parse((await loadSetting(key(uid, season))) || '{}') || {}; } catch { return {}; }
}
export async function savePicks(uid: string, season: number, p: PickMap) { await saveSetting(key(uid, season), JSON.stringify(p)); }

export type LbMe = { uid: string; un: string; av?: string; display?: string; joinedAt: number };
export async function loadLbMe(appUid: string): Promise<LbMe | null> { try { return JSON.parse((await loadSetting('lb:me:' + appUid)) || 'null'); } catch { return null; } }
export async function saveLbMe(appUid: string, me: LbMe | null) { await saveSetting('lb:me:' + appUid, me ? JSON.stringify(me) : ''); }
export async function loadPref(k: string, d: string) { return (await loadSetting('picks:pref:' + k)) ?? d; }
export async function savePref(k: string, v: string) { await saveSetting('picks:pref:' + k, v); }
