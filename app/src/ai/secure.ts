// Device-only secret storage. Android/iOS: expo-secure-store (Android Keystore-encrypted SharedPreferences).
// Web (dev screenshots only): localStorage, since SecureStore has no web implementation.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const web = Platform.OS === 'web';
export async function getSecret(k: string): Promise<string | null> {
  try { return web ? (globalThis as any).localStorage?.getItem('ggsec_' + k) ?? null : await SecureStore.getItemAsync(k); } catch { return null; }
}
export async function setSecret(k: string, v: string) {
  if (web) { (globalThis as any).localStorage?.setItem('ggsec_' + k, v); return; }
  await SecureStore.setItemAsync(k, v);
}
export async function delSecret(k: string) {
  try { if (web) (globalThis as any).localStorage?.removeItem('ggsec_' + k); else await SecureStore.deleteItemAsync(k); } catch {}
}

import { configureAi } from './client';
configureAi({ get: getSecret, set: setSecret, del: async k => delSecret(k) }, Platform.OS === 'android' ? `Android ${Platform.Version} phone` : Platform.OS === 'ios' ? 'iPhone' : 'Web preview');
