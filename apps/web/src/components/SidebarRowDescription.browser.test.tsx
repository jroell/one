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
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
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

it("the focused sidebar row's description names the provider, so two similar threads differ", async () => {
  await page.viewport(1400, 900);
  const codex = threadWithHistory("twin-codex", 1);
  const claude = {
    ...threadWithHistory("twin-claude", 1),
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-6" },
  } as unknown as typeof codex;
  using _environment = installFakeEnvironment([codex, claude], {
    providers: [CODEX_PROVIDER, CLAUDE_PROVIDER],
  });
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${codex.id}`);
  await using _app = app;
  using _focus = focus;
  const rowFor = (thread: typeof codex) =>
    page.getByTestId("sidebar-row-card").filter({ hasText: thread.title });
  await expect.element(rowFor(codex), { timeout: 8000 }).toBeVisible();
  await expect.element(rowFor(claude)).toBeVisible();
  const describe = (thread: typeof codex) => {
    const row = rowFor(thread).element();
    const ids = row.getAttribute("aria-describedby")?.split(" ") ?? [];
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  };
  expect(describe(codex)).toMatch(/Runs on Codex/);
  expect(describe(claude)).toMatch(/Runs on Claude/);
  // One environment: the device is not part of the description.
  expect(describe(claude)).not.toContain("Render scenarios");
});
