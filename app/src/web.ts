// v0.0.6: iPhone web app (PWA) helpers. All of this is inert on Android (Platform.OS is inlined, so it's dead code there).
import { Platform } from 'react-native';
export const IS_WEB = Platform.OS === 'web';
/** Secret folder the PWA is served from, e.g. "/abc123…" (set at export time via EXPO_PUBLIC_PWA_BASE). */
export const PWA_BASE: string = (process.env.EXPO_PUBLIC_PWA_BASE as string) || '';
const host = () => (IS_WEB && typeof window !== 'undefined' ? window.location.hostname : '');
/** Running as the hosted PWA (not the local web preview used for screenshots). */
export const isHostedPwa = () => IS_WEB && /\.here\.now$/.test(host()) && !!PWA_BASE;
/**
 * Read-only relay = here.now proxy routes on the same site (publish-site/.herenow/proxy.json). Each route has one fixed
 * upstream (that's the host allowlist), GET only, no headers or keys added:
 *   <base>/relay/yt    -> https://www.youtube.com/feeds/videos.xml   (YouTube RSS has no CORS)
 *   <base>/relay/espn/* -> https://site.api.espn.com/apis/site/v2/sports/football/nfl/*  (fallback only; ESPN sends CORS *)
 */
export const relayUrl = (k: 'yt' | 'espn', rest = '') => `${PWA_BASE}/relay/${k}${rest}`;
export const isStandalone = () => IS_WEB && typeof window !== 'undefined' && (!!(window.navigator as any).standalone || !!window.matchMedia?.('(display-mode: standalone)').matches);
