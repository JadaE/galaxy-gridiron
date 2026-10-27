import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../ui';
import { C } from '../theme';
import { VERSION_NAME } from '../version';
import { openDownload, isWebApp } from '../update';

/** Galaxy-styled "Update available" banner with one-tap download. */
export default function UpdateBanner() {
  const { update, dismissUpdate } = useApp();
  if (!update) return null;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.gold + '88' }}>
      <LinearGradient colors={['#4B2A9A', '#2A1B5E', '#123A4A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 14 }}>
        <LinearGradient colors={['rgba(255,200,87,0.28)', 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.3, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 28 }}>🚀</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.gold, fontWeight: '900', fontSize: 15 }}>{isWebApp() ? 'New version' : 'Update available'} · v{update.versionName}</Text>
            <Text style={{ color: '#C9C3F5', fontSize: 11.5 }}>You have v{VERSION_NAME}</Text>
          </View>
        </View>
        {update.notes ? <Text style={{ color: C.text, fontSize: 12.5, marginTop: 8, lineHeight: 17 }} numberOfLines={4}>{update.notes}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Pressable onPress={() => openDownload(update)} style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
            <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 11, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>{isWebApp() ? '↻ Reload to update' : '⬇ Download update'}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={dismissUpdate} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 10 }}><Text style={{ color: C.sub, fontWeight: '700' }}>Later</Text></Pressable>
        </View>
        <Text style={{ color: C.dim, fontSize: 10.5, marginTop: 8 }}>{isWebApp() ? 'Reloads the app with the new version. Your settings stay.' : 'Opens in Chrome. Tap the downloaded file, then Update. Your settings stay.'}</Text>
      </LinearGradient>
    </View>
  );
}
