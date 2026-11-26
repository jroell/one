import { createMemoryHistory } from "@tanstack/react-router";
import { ProjectId } from "@t3tools/contracts";
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

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sidebar-row-card"]'));

it("draws a thread with no pull request or device as one line, with the project and provider beside the title", async () => {
  await page.viewport(1400, 900);
  const other = ProjectId.make("project-other");
  const threads = [
    threadWithHistory("line-a", 1),
    threadWithHistory("line-b", 1),
    { ...threadWithHistory("line-c", 1), projectId: other },
    { ...threadWithHistory("line-d", 1), projectId: other },
  ];
  using _environment = installFakeEnvironment(threads, {
    extraProjects: [{ id: other, title: "other" }],
  });
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[0]!.id}`);
  await using _app = app;
  using _focus = focus;
  await expect
    .element(page.getByTestId("sidebar-row-card").first(), { timeout: 8000 })
    .toBeVisible();
  await vi.waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(4));
  // Two projects are listed, so no row hides which one it is in.
  expect(document.querySelector("[data-sidebar-sole-project]")).toBeNull();
  for (const row of rows()) {
    const title = row.querySelector<HTMLElement>("[class*='truncate']")!.getBoundingClientRect();
    const project = row.querySelector<HTMLElement>("[data-sidebar-row-project]");
    const provider = row.querySelector<HTMLElement>("[data-sidebar-provider]");
    expect(project, row.textContent ?? "").not.toBeNull();
    expect(provider, row.textContent ?? "").not.toBeNull();
    // One line: the row is no taller than a title line with its padding.
    expect(row.getBoundingClientRect().height).toBeLessThan(40);
    for (const beside of [project!, provider!]) {
      const box = beside.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(title.top - 4);
      expect(box.bottom).toBeLessThanOrEqual(title.bottom + 4);
    }
  }
});
