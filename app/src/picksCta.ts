// JC-59: Team-tab shortcut to this week's picks. Opening the Picks tab already shows the current NFL week.
export const THIS_WEEK_PICKS_LABEL = "Make this week's picks";
export const THIS_WEEK_PICKS_TAB = 'Picks';

/** Hidden in a past-season replay, where there is no current week to pick. */
export function shouldShowThisWeekPicksCta(opts: { isPast: boolean }): boolean {
  return !opts.isPast;
}
