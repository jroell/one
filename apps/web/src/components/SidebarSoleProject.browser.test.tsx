import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

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

it("when every sidebar row is in one project, the project is named once above the list", async () => {
  await page.viewport(1400, 900);
  const threads = Array.from({ length: 4 }, (_, index) => threadWithHistory(`solo-${index}`, 1));
  using _environment = installFakeEnvironment(threads);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[0]!.id}`);
  await using _app = app;
  using _focus = focus;
  await expect
    .element(page.getByTestId("sidebar-row-card").first(), { timeout: 8000 })
    .toBeVisible();
  const headers = document.querySelectorAll("[data-sidebar-sole-project]");
  expect(headers).toHaveLength(1);
  const projectName = headers[0]!.textContent!.trim();
  expect(projectName.length).toBeGreaterThan(0);
  for (const row of document.querySelectorAll('[data-testid="sidebar-row-card"]')) {
    expect(row.textContent).not.toContain(projectName);
  }
});
