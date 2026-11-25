import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

import { initializeI18n } from "../src/i18n/initializeI18n";
import { OPENING_SEEN_KEY } from "../src/one/openingPreferences";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Moves Playwright's mouse off the page. */
    resetPointer: () => Promise<void>;
    /** Defined in vite.config.ts. Presses the primary button where the mouse is, without releasing. */
    pointerDown: () => Promise<void>;
    /** Defined in vite.config.ts. Releases the primary button. */
    pointerUp: () => Promise<void>;
  }
}

// Playwright's mouse outlives each test and each file, so whatever the next test mounts
// under its last position starts hovered. Registered here rather than in render() so tests
// that mount without it are covered too. Before each test, not after: a timed-out test keeps
// running and can move the mouse after its own afterEach.
beforeEach(async () => {
  await commands.resetPointer();
  // The opening covers the app and takes the first key or click to skip itself. Tests that mount
  // the whole app start after it; a test of the opening removes this key first.
  window.sessionStorage.setItem(OPENING_SEEN_KEY, "1");
});

// The app initializes GT at startup; components using its hooks need the same here.
initializeI18n(() => {});
