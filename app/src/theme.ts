export const C = {
  bg: '#0B1022',
  bg2: '#0F1426',
  card: '#161C33',
  card2: '#1C2340',
  border: '#272F52',
  text: '#EEF1FF',
  sub: '#9AA3C7',
  dim: '#636C93',
  mint: '#00CEB8',
  mintSoft: 'rgba(0,206,184,0.15)',
  purple: '#7B5CFF',
  magenta: '#C64CFF',
  pink: '#FF5FA2',
  gold: '#FFC857',
  red: '#FF5C7A',
  green: '#3DDC97',
  orange: '#FF9F43',
};
export const POS_COLOR: Record<string, string> = {
  QB: '#FF5F8F', RB: '#2FE0B5', WR: '#56B4FF', TE: '#FFA94D', K: '#C7A8FF', DEF: '#B4BDD9', FLEX: '#8E8CFF',
};
export const posColor = (p?: string) => POS_COLOR[p || ''] || C.sub;
