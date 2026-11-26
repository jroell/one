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

it("a focused sidebar row under the sole-project header still names its project", async () => {
  await page.viewport(1400, 900);
  const threads = Array.from({ length: 3 }, (_, index) => threadWithHistory(`named-${index}`, 1));
  using _environment = installFakeEnvironment(threads);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[0]!.id}`);
  await using _app = app;
  using _focus = focus;
  await expect
    .element(page.getByTestId("sidebar-row-card").first(), { timeout: 8000 })
    .toBeVisible();
  const rowFor = (title: string) =>
    [...document.querySelectorAll('[data-testid="sidebar-row-card"]')].find((card) =>
      card.textContent?.includes(title),
    );
  await vi.waitFor(() => expect(rowFor(threads[1]!.title)).toBeDefined(), { timeout: 8000 });
  const projectName = document
    .querySelector("[data-sidebar-sole-project]")!
    .lastElementChild!.textContent!.trim();
  const row = rowFor(threads[1]!.title)!;
  const description = (row.getAttribute("aria-describedby")?.split(" ") ?? [])
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  expect(`${row.getAttribute("aria-label") ?? ""} ${description}`).toContain(projectName);
  // The name is still shown once, above the list, and not inside each row.
  expect(row.textContent).not.toContain(projectName);
});
