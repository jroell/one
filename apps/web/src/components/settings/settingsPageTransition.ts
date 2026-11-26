/**
 * Passed to a router `navigate` that changes the page inside the Settings sheet, so the page body
 * cross-fades (see `settings-body` in one-settings.css) instead of the old page cutting out. The
 * router skips it where the browser has no view transitions.
 */
export const SETTINGS_PAGE_TRANSITION = { types: ["settings-page"] };
