import { useLocation, useMatches } from "@tanstack/react-router";

/** "/settings/general/" and "/settings/" lose their trailing slash; the root stays "/". */
export function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function isSettingsPath(path: string): boolean {
  return path === "/settings" || path.startsWith("/settings/");
}

/**
 * The settings page the router matched, written the way the route tree spells it.
 *
 * The router matches "/Settings/General" and "/settings/general/" to the same page, so chrome
 * and scope rules read the matched route's path instead of the address the browser holds.
 * Without a matched settings route it falls back to the trimmed address.
 */
export function useSettingsPathname(): string {
  const matched = useMatches({
    select: (matches) =>
      matches.findLast((match) => isSettingsPath(trimTrailingSlashes(match.fullPath)))?.fullPath,
  });
  const address = useLocation({ select: (location) => location.pathname });
  return trimTrailingSlashes(matched ?? address);
}
