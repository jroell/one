import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import * as DateTime from "effect/DateTime";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

import "~/index.css";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

async function openApp(path: string) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  return { app, focus: { [Symbol.dispose]: startWorkspaceFocus(router) } };
}

it("a thread whose run failed shows the oxblood mark and its word, and is not counted as needing the person", async () => {
  await page.viewport(1400, 900);
  const failed = {
    ...threadWithHistory("broke-0", 1),
    status: "failed",
    lastVisitedAt: DateTime.makeUnsafe("2026-03-17T19:00:00.000Z"),
  } as unknown as ReturnType<typeof threadWithHistory>;
  const threads = [failed, threadWithHistory("calm-1", 1)];
  using _environment = installFakeEnvironment(threads);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[1]!.id}`);
  await using _app = app;
  using _focus = focus;
  const mark = await vi.waitFor(
    () => {
      const found = document.querySelector<HTMLElement>('[data-sidebar-status="failed"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    },
    { timeout: 8000 },
  );
  const word = mark.closest<HTMLElement>("[data-sidebar-status-word]");
  expect(word?.textContent).toContain("Failed");
  // The mark and its word take the status color, whatever the theme.
  const probe = document.createElement("span");
  probe.style.color = "var(--st-error)";
  document.body.append(probe);
  const oxblood = getComputedStyle(probe).color;
  probe.remove();
  expect(getComputedStyle(mark).color).toBe(oxblood);
  expect(getComputedStyle(word!).color).toBe(oxblood);
  expect(document.querySelector("[data-sidebar-needs-you]")).toBeNull();
});
