/**
 * The app opens on the calendar, the summary of the day. Links and notifications still open
 * where they point.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  // The bare app URL ("macro:///"), as iOS gives it when the app starts from the home screen.
  const rest = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return initial && /^\/?(\?.*)?$/.test(rest) ? '/calendar' : path;
}
