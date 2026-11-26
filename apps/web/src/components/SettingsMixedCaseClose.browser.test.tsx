import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { startMainAppLocationTracking } from "~/components/sidebar/mainAppLocation";
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
  const app = await render(<AppRoot router={router} />, { router: false });
  // The app shell starts both in startAppServices; this renders the shell without those services.
  return {
    app,
    router,
    focus: {
      [Symbol.dispose]: (
        (stops) => () =>
          stops.forEach((stop) => stop())
      )([startWorkspaceFocus(router), startMainAppLocationTracking(router)]),
    },
  };
}

const isSettingsAddress = (pathname: string) => pathname.toLowerCase().startsWith("/settings");

it("Escape on a mixed-case Settings address returns to the thread it opened over", async () => {
  await page.viewport(1400, 900);
  using _environment = installFakeEnvironment([threadWithHistory("return", 1)]);
  const threadPath = `/${ENVIRONMENT_ID}/return`;
  const { app, focus, router } = await openApp(threadPath);
  await using _app = app;
  using _focus = focus;
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(threadPath));

  await router.navigate({ href: "/Settings/General" });
  await expect.element(page.getByRole("dialog"), { timeout: 8000 }).toBeVisible();
  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => expect(router.state.location.pathname).toBe(threadPath));
});

it("Escape on a cold mixed-case Settings link leaves Settings", async () => {
  await page.viewport(1400, 900);
  using _environment = installFakeEnvironment([threadWithHistory("cold", 1)]);
  const { app, focus, router } = await openApp("/Settings/General/");
  await using _app = app;
  using _focus = focus;
  await expect.element(page.getByRole("dialog"), { timeout: 8000 }).toBeVisible();

  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => expect(isSettingsAddress(router.state.location.pathname)).toBe(false));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
