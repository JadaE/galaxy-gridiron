// JC-13: first-load hint to add the web app to the Home Screen. iOS may clear picks from a regular browser tab.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { C } from '../theme';
import { loadSetting, saveSetting } from '../api';
import { IS_WEB, INSTALL_HINT_KEY, isStandalone, shouldShowInstallHint, installHintCopy } from '../web';

export default function InstallHint({ compact = false }: { compact?: boolean }) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => { loadSetting(INSTALL_HINT_KEY).then(v => setDismissed(!!v)); }, []);
  if (dismissed === null) return null;
  if (!shouldShowInstallHint({ web: IS_WEB, standalone: isStandalone(), dismissed })) return null;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const copy = installHintCopy(nav?.userAgent || '', nav?.maxTouchPoints || 0);
  const dismiss = () => { setDismissed(true); saveSetting(INSTALL_HINT_KEY, String(Date.now())); };
  return (
    <View testID="install-hint" style={{ borderRadius: 16, borderWidth: 1, borderColor: C.gold + '88', backgroundColor: C.gold + '14', padding: compact ? 12 : 14, gap: 6 }}>
      <Text style={{ color: C.gold, fontWeight: '900', fontSize: compact ? 13.5 : 15 }}>{copy.title}</Text>
      <Text style={{ color: '#C9C3F5', fontSize: compact ? 12 : 13, lineHeight: compact ? 17 : 18 }}>{copy.body}</Text>
      <Text style={{ color: C.text, fontSize: compact ? 12 : 13, lineHeight: compact ? 17 : 18, fontWeight: '700' }}>{copy.steps}</Text>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-end', paddingVertical: 4 }}>
        <Text style={{ color: C.sub, fontWeight: '800', fontSize: 12 }}>{Platform.OS === 'web' ? 'I already did · Hide' : 'Hide'}</Text>
      </Pressable>
    </View>
  );
}
