import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import { openCommandPalette } from "~/commandPaletteBus";
// ChatView is a large lazy module; importing it here keeps its load out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { startWorkspaceFocus } from "~/lib/workspaceFocus";
import { useRightPanelStore } from "~/rightPanelStore";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  emitVcsStatus,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

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

const repository = (isRepo: boolean) => ({
  isRepo,
  hasPrimaryRemote: isRepo,
  isDefaultRef: true,
  refName: isRepo ? "main" : null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
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

it("a sidebar thread row is two lines: title and time, then the project and a named provider glyph", async () => {
  await page.viewport(1400, 900);
  const thread = threadWithHistory("sidebar-card", 1);
  using _environment = installFakeEnvironment([thread]);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${thread.id}`);
  await using _app = app;
  using _focus = focus;
  const row = page.getByTestId("sidebar-row-card").filter({ hasText: thread.title });
  await expect.element(row, { timeout: 8000 }).toBeVisible();
  const card = row.element() as HTMLElement;
  // About 52px, down from 83: title and time on one line, one quiet meta line under it.
  expect(card.getBoundingClientRect().height).toBeLessThan(56);
  const title = card.querySelector("span.truncate")!;
  expect(title.textContent).toBe(thread.title);
  // One environment connected and this thread on it: the device is not repeated on the row.
  expect(card.textContent).not.toContain("Local");
  const provider = card.querySelector("[data-sidebar-provider]")!;
  expect(provider.getAttribute("role")).toBe("img");
  expect(provider.getAttribute("aria-label")).toMatch(/^Runs on /);
});

it("an empty thread in a plain folder offers no Review changes, and one in a repository does", async () => {
  const thread = threadWithHistory("welcome-empty", 0);
  using _environment = installFakeEnvironment([thread]);
  const { app, focus } = await openApp(`/${ENVIRONMENT_ID}/${thread.id}`);
  await using _app = app;
  using _focus = focus;
  const starters = page.getByRole("list", { name: "Ways to start" });
  await expect.element(starters).toBeVisible();

  await act(() => emitVcsStatus({ _tag: "snapshot", local: repository(false), remote: null }));
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: /Review changes/ }).elements()).toHaveLength(0),
  );
  // A file takes the diff's place, so the set stays four.
  expect(starters.getByRole("button").elements()).toHaveLength(4);
  expect(page.getByRole("button", { name: /Open a file/ }).elements()).toHaveLength(1);

  await act(() => emitVcsStatus({ _tag: "localUpdated", local: repository(true) }));
  await expect.element(page.getByRole("button", { name: /Review changes/ })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: /Review changes/ }));
  const panels = Object.values(useRightPanelStore.getState().byThreadKey);
  expect(panels.some((panel) => panel.surfaces.some((surface) => surface.kind === "diff"))).toBe(
    true,
  );
});

it.each([
  ["/issues", "Search issues"],
  ["/pull-requests", "Search pull requests"],
] as const)(
  "%s: slash focuses search on arrival-free pages, including a layout that types it with Shift",
  async (route, label) => {
    using _environment = installFakeEnvironment([threadWithHistory("slash", 1)]);
    const { app, focus } = await openApp(route);
    await using _app = app;
    using _focus = focus;
    const search = page.getByRole("searchbox", { name: label });
    await expect.element(search).toBeVisible();
    const searchField = search.element();
    // Neither page puts the caret in the field on arrival, with the focus controller running.
    expect(document.activeElement).not.toBe(searchField);

    const press = (init: KeyboardEventInit, target: Element = document.body) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
        );
      });

    // German Shift+7: the browser reports key "/" with shift held.
    await press({ key: "/", code: "Digit7", shiftKey: true });
    expect(document.activeElement).toBe(searchField);

    (document.activeElement as HTMLElement).blur();
    // Shift on the physical Slash key types "?" and must not jump to search.
    await press({ key: "?", code: "Slash", shiftKey: true });
    expect(document.activeElement).not.toBe(searchField);
    // Composition (an IME confirming a key) never counts.
    await press({ key: "/", code: "Slash", isComposing: true });
    expect(document.activeElement).not.toBe(searchField);
    // A text field elsewhere keeps its slash.
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    await press({ key: "/", code: "Slash" }, field);
    expect(document.activeElement).toBe(field);
    field.remove();

    // Inside a dialog (the command palette) the slash belongs to the dialog.
    await act(() => openCommandPalette());
    const dialog = await vi.waitFor(() => {
      const found = document.querySelector('[role="dialog"]');
      expect(found).not.toBeNull();
      return found!;
    });
    await press({ key: "/", code: "Slash" }, dialog);
    expect(document.activeElement).not.toBe(searchField);
  },
);
