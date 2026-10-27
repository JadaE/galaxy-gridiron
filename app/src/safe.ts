// v0.0.5: Android safe areas.
// SDK 58 / RN 0.88 builds are always edge-to-edge (android/gradle.properties edgeToEdgeEnabled=true), and with that flag on
// RN forces every <Modal> to draw behind the status and navigation bars too (ReactModalHostView: statusBarTranslucent/
// navigationBarTranslucent are ORed with isEdgeToEdgeFeatureFlagOn). So anything pinned to the bottom, in the main window
// or in a modal, must add the bottom inset itself. Insets come from the root SafeAreaProvider; context passes into modals.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Web-preview only: ?inset=48 simulates 3-button nav, ?inset=24 gesture nav (dead code on device). */
function simInset(): number | null {
  if (Platform.OS !== 'web') return null;
  try { const v = new URLSearchParams((globalThis as any).location?.search || '').get('inset'); return v == null ? null : Number(v) || 0; } catch { return null; }
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return open;
}

export function useInsets() {
  const i = useSafeAreaInsets();
  const s = simInset();
  return s == null ? i : { ...i, bottom: s, top: Math.max(i.top, 24) };
}

/** Bottom padding for bottom-pinned UI: at least `min`, plus the nav bar inset, but not while the keyboard covers the nav bar. */
export function useBottomPad(min = 8, keyboardAware = false): number {
  const { bottom } = useInsets();
  const kb = useKeyboardOpen();
  if (keyboardAware && kb) return min;
  return Math.max(bottom + min * 0.5, min);
}
