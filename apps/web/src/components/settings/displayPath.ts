/**
 * A folder path as people say it: the home folder is "~". The client never learns the server's
 * home folder, so this reads it from the usual layouts (macOS, Linux, Windows) and leaves any
 * other path as it is.
 */
export function displayPath(path: string): string {
  const unix = /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(path);
  if (unix) return `~${path.slice(unix[0].length)}`;
  const windows = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+(?=[\\/]|$)/.exec(path);
  if (windows) return `~${path.slice(windows[0].length)}`;
  return path;
}
