import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { RuntimeRequestId } from "@t3tools/contracts";
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

it("one header names how many rows need the person, and each of those rows shows an ember dot, not a chip", async () => {
  await page.viewport(1400, 900);
  const approval = (name: string) =>
    ({
      ...threadWithHistory(name, 1),
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make(`${name}-request`),
        kind: "command_approval",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    }) as unknown as ReturnType<typeof threadWithHistory>;
  const threads = [approval("needs-0"), approval("needs-1"), threadWithHistory("calm-0", 1)];
  using _environment = installFakeEnvironment(threads);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${threads[2]!.id}`);
  await using _app = app;
  using _focus = focus;
  const header = await vi.waitFor(
    () => {
      const found = document.querySelector<HTMLElement>("[data-sidebar-needs-you]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    },
    { timeout: 8000 },
  );
  expect(document.querySelectorAll("[data-sidebar-needs-you]")).toHaveLength(1);
  expect(header.textContent).toContain("2 need you");
  // The count and the dots come from one rule, so they cannot disagree.
  const counted = Number(/\d+/.exec(header.textContent ?? "")?.[0]);
  expect(document.querySelectorAll('[data-sidebar-status="attention"]')).toHaveLength(counted);

  const rows = [...document.querySelectorAll('[data-testid="sidebar-row-card"]')];
  const needing = rows.filter((row) => row.textContent?.includes("needs-"));
  expect(needing).toHaveLength(2);
  // They sit together right under the header, ahead of every other row.
  expect(rows.slice(0, 2)).toEqual(needing);
  expect(
    header.compareDocumentPosition(needing[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  for (const row of needing) {
    expect(row.querySelector('[data-sidebar-status="attention"]')).not.toBeNull();
    // The word stays for assistive technology but takes no room: it is not a chip.
    const word = [...row.querySelectorAll("span")].find(
      (span) => span.children.length === 0 && span.textContent === "Needs approval",
    );
    expect(word).toBeDefined();
    expect(word!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  }
  const calm = rows.find((row) => row.textContent?.includes("calm-0"))!;
  expect(calm.querySelector('[data-sidebar-status="attention"]')).toBeNull();

  await userEvent.click(header.querySelector("button")!);
  await vi.waitFor(() =>
    expect(location.pathname).not.toBe(`/${ENVIRONMENT_ID}/${threads[2]!.id}`),
  );
});
