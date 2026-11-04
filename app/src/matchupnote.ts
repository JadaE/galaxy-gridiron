// v0.0.12: the "N players still to play" note goes under the side that actually has players left (both sides when both do).
export const leftNote = (n: number) => (n > 0 ? `${n} player${n === 1 ? '' : 's'} still to play` : '');
export function sideNotes(meLeft: number, oppLeft: number, started: boolean, allFinal: boolean): { me: string; opp: string } {
  if (!started || allFinal) return { me: '', opp: '' };
  return { me: leftNote(meLeft), opp: leftNote(oppLeft) };
}
