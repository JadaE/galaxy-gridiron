import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Chip, useApp, T } from '../ui';
import { tradeDeadlineStatus, tradeDeadlineWeek, deadlineSubtitle } from '../deadline';
import { defaultPickupsPane, type PickupsPane } from '../pickups';
import { PLAYOFF_COPY } from '../playoffRace';
import Trades from './Trades';
import Waivers from './Waivers';

export default function Pickups({ requested }: { requested?: PickupsPane | 'default' | null }) {
  const { b } = useApp();
  const status = tradeDeadlineStatus(b);
  const [pane, setPane] = useState<PickupsPane>(() =>
    requested === 'trades' || requested === 'waivers' ? requested : defaultPickupsPane(status)
  );
  const lastLeague = useRef(b.league.league_id);

  useEffect(() => {
    const lid = b.league.league_id;
    if (lastLeague.current !== lid) {
      lastLeague.current = lid;
      setPane(defaultPickupsPane(tradeDeadlineStatus(b)));
      return;
    }
    if (requested === 'trades' || requested === 'waivers') setPane(requested);
    else if (requested === 'default') setPane(defaultPickupsPane(tradeDeadlineStatus(b)));
  }, [b.league.league_id, requested]);

  const dWeek = tradeDeadlineWeek(b);
  const closed = status === 'closed';
  const sub = pane === 'trades'
    ? deadlineSubtitle(status, dWeek)
    : `Waiver priority: ${b.me.waiverPos ? '#' + b.me.waiverPos : '-'} of ${b.teams.length}`;

  return (
    <Screen info={pane === 'trades' ? 'trades' : 'waivers'} title="Player pickups" subtitle={sub}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 2 }}>
        <Chip label="Trades" active={pane === 'trades'} onPress={() => setPane('trades')} />
        <Chip label="Waivers" active={pane === 'waivers'} onPress={() => setPane('waivers')} />
      </View>
      {pane === 'trades' && closed ? <Text style={[T.sub, { marginBottom: 8, paddingHorizontal: 4 }]}>{PLAYOFF_COPY.waiversStillOpen}</Text> : null}
      {pane === 'trades' ? <Trades embedded /> : <Waivers embedded />}
    </Screen>
  );
}
