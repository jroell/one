import type { SettingsPath } from "./settingsSearch";

/**
 * Detail pages without a navigation entry. The navigation highlights the page that links to
 * them, and the breadcrumb names that page between "Settings" and the detail page.
 */
export const SETTINGS_DETAIL_PAGE_PARENTS: Readonly<Record<string, SettingsPath>> = {
  "/settings/diagnostics": "/settings/maintenance",
  "/settings/open-source-licenses": "/settings/about",
};
