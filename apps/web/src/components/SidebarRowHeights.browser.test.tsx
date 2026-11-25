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

it("skipped sidebar rows reserve exactly the height they paint, however many are unpainted", async () => {
  await page.viewport(1400, 900);
  const threads = Array.from({ length: 40 }, (_, index) => threadWithHistory(`skip-${index}`, 1));
  using _environment = installFakeEnvironment(threads);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[0]!.id}`);
  await using _app = app;
  using _focus = focus;
  await expect
    .element(page.getByTestId("sidebar-row-card").first(), { timeout: 8000 })
    .toBeVisible();
  const items = Array.from(document.querySelectorAll<HTMLElement>("[data-thread-item]"));
  expect(items.length).toBeGreaterThanOrEqual(30);
  const painted = items.filter((item) => item.getBoundingClientRect().top < window.innerHeight);
  const skipped = items.filter((item) => item.getBoundingClientRect().top >= window.innerHeight);
  expect(painted.length).toBeGreaterThan(5);
  expect(skipped.length).toBeGreaterThan(10);
  const paintedHeight = painted[0]!.getBoundingClientRect().height;
  // Every skipped row is the height of a painted one: any per-row error would add up here.
  for (const item of skipped) expect(item.getBoundingClientRect().height).toBe(paintedHeight);
});
