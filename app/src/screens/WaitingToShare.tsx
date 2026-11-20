// JC-38 / JC-60: small count of unsent pick snapshots so a missed share is visible off the Picks tab too.
import React, { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useApp } from '../ui';
import { C } from '../theme';
import { subscribePending } from '../picks/sync';

export const WAITING_TO_SHARE_LABEL = 'Waiting to share';

export default function WaitingToShare() {
  const { go } = useApp();
  const [n, setN] = useState(0);
  useEffect(() => subscribePending(setN), []);
  if (n <= 0) return null;
  return (
    <Pressable onPress={() => go('Picks')} accessibilityLabel={`${WAITING_TO_SHARE_LABEL}: ${n}`} style={{ borderRadius: 14, borderWidth: 1, borderColor: C.gold + '99', backgroundColor: 'rgba(245, 200, 66, 0.12)', padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 14 }}>⏳</Text>
      <Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{WAITING_TO_SHARE_LABEL}</Text>
      <Text style={{ color: C.gold, fontWeight: '800' }}>{n}</Text>
    </Pressable>
  );
}
