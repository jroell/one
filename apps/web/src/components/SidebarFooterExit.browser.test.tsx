import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { getRouter } from "~/router";
import {
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

const capability = vi.hoisted(() => ({ supported: true }));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePullRequestsSupported: () => capability.supported,
  useIssuesSupported: () => capability.supported,
}));

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
  return { app, router, focus: { [Symbol.dispose]: startWorkspaceFocus(router) } };
}

it.each([
  ["/pull-requests", "Pull requests", true],
  ["/pull-requests", "Pull requests", false],
  ["/issues", "Issues", true],
  ["/Issues", "Issues", false],
] as const)(
  "%s with support %s: the footer's lit icon is the way back to the workspace",
  async (path, name, supported) => {
    capability.supported = supported;
    await page.viewport(1400, 900);
    using _environment = installFakeEnvironment([threadWithHistory("exit", 1)]);
    const { app, focus, router } = await openApp(path);
    await using _app = app;
    using _focus = focus;
    const back = page.getByRole("button", { name: `Back from ${name}`, exact: true });
    await expect.element(back, { timeout: 8000 }).toBeVisible();
    await expect.element(back).toHaveAttribute("aria-current", "page");
    // The generic Back button stays out of the way, and the exit works.
    expect(page.getByRole("button", { name: "Back", exact: true }).elements()).toHaveLength(0);
    await userEvent.click(back);
    await vi.waitFor(() =>
      expect(router.state.location.pathname.toLowerCase()).not.toBe(path.toLowerCase()),
    );
  },
);
