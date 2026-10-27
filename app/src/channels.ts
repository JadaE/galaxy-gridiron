// YouTube channels for the Videos tab (IDs verified via public RSS on 2026-10-21).
export type Channel = { id: string; name: string; short: string; group: 'TGS' | 'Fantasy' | 'NFL' | 'Shows'; handle?: string };
export const CHANNELS: Channel[] = [
  { id: 'UCew5br5cO1ZKO7Z_F1WA8Bg', name: 'ThatsGoodSports', short: 'TGS', group: 'TGS' },
  { id: 'UC8EdaOMUeFaLHbn8BojZ2hA', name: 'Grossi Perna Show Clips', short: 'Grossi & Perna', group: 'TGS' },
  { id: 'UCg6jOxpPC46mnBs9NsgLcvg', name: 'Tom Grossi', short: 'Tom Grossi', group: 'TGS' },
  { id: 'UCYzfVBuCfGz-oF3aOCGgO5g', name: 'Brett Kollmann', short: 'Kollmann', group: 'Shows' },
  { id: 'UC6gWjMSDj7-8j3iCc2ZGo3g', name: 'The Athletic Football Show', short: 'Athletic FB Show', group: 'Shows' },
  { id: 'UCxcTeAKWJca6XyJ37_ZoKIQ', name: 'The Pat McAfee Show', short: 'McAfee', group: 'Shows' },
  { id: 'UCylgcI1N1S3zHljDO8eW-Qg', name: "Bussin' With The Boys", short: 'Bussin', group: 'Shows' },
  { id: 'UC-No2ITxJsNt50oJQ3fLmUA', name: 'The Fantasy Footballers', short: 'Footballers', group: 'Fantasy' },
  { id: 'UCK5szBUaJMnuCViD6alvuXg', name: 'Late-Round Fantasy Football', short: 'Late-Round', group: 'Fantasy' },
  { id: 'UCaCshQX7-gQ0Bs5BnddUwZg', name: 'Fantasy Points', short: 'Fantasy Points', group: 'Fantasy' },
  { id: 'UCZYaxEBdyKDsZfq_JGZwIeQ', name: 'FantasyPros', short: 'FantasyPros', group: 'Fantasy' },
  { id: 'UC7fnz7139CGSdtHWaPMCpIw', name: 'Yahoo Fantasy (Josh & Hayden)', short: 'Yahoo FF', group: 'Fantasy' },
  { id: 'UCviK78rIWXhZdFzJ1Woi7Fg', name: 'Fantasy Football Today', short: 'FFToday', group: 'Fantasy' },
  { id: 'UCz9CnGPhYaKOw4-wcu6F_Qg', name: 'SleeperHQ', short: 'Sleeper', group: 'Fantasy' },
  { id: 'UCyMng_8VKXye0ObmRX7Occw', name: 'Dynasty Nerds', short: 'Dynasty Nerds', group: 'Fantasy' },
  { id: 'UCClRnPtjFEm7Is7hpSoTBeg', name: 'The Fantasy Headliners', short: 'Headliners', group: 'Fantasy' },
  { id: 'UCUDpxEz7PAI55ptRvMcWEdg', name: 'NFL Fantasy Football', short: 'NFL Fantasy', group: 'NFL' },
  { id: 'UCDVYQ4Zhbm3S2dlz7P1GBDg', name: 'NFL', short: 'NFL', group: 'NFL' },
  { id: 'UCiio0ydw439X13KyZgMIcHw', name: 'NFL on ESPN', short: 'ESPN', group: 'NFL' },
  { id: 'UCvQrivswRDGK0lZ_AcUHp8g', name: 'NFL on FOX', short: 'FOX', group: 'NFL' },
  { id: 'UC7ZUfHFsuQcW7BkTHnXJtqw', name: 'NFL on CBS', short: 'CBS', group: 'NFL' },
  { id: 'UCcsw_KrB_wg5lQ5nXWR_LFA', name: 'Minnesota Vikings', short: 'Vikings', group: 'NFL' },
  { id: 'UCzjCfV3LHyarKbdb-2ScGZg', name: 'Atlanta Falcons', short: 'Falcons', group: 'NFL' },
];
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}/videos`;
