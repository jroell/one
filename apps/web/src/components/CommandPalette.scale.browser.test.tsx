import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { LAST_USED_PROJECT_STORAGE_KEY } from "../hooks/useHandleNewThread";
import { removeLocalStorageItem } from "../hooks/useLocalStorage";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import type { ThreadRouteTarget } from "../threadRoutes";
import { CommandPalette } from "./CommandPalette";
import { type CommandPaletteActionItem } from "./CommandPalette.logic";

const builds = vi.hoisted(() => ({ count: 0 }));
vi.mock(import("./CommandPalette.logic"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    // Counts the times the cached thread items are really built.
    cachedThreadActionItems: (
      deps: ReadonlyArray<unknown>,
      build: () => CommandPaletteActionItem[],
    ) =>
      actual.cachedThreadActionItems(deps, () => {
        builds.count += 1;
        return build();
      }),
  };
});

const entities = vi.hoisted(() => ({
  projects: [] as ReadonlyArray<Project>,
  threads: [] as ReadonlyArray<Thread>,
  activeThread: undefined as Thread | undefined,
  routeTarget: null as ThreadRouteTarget | null,
  delegatedUnderParent: new Set<string>() as ReadonlySet<string>,
  handleNewThread: vi.fn(async () => undefined),
}));
vi.mock("../state/server", async (original) => {
  const actual = await original<typeof import("../state/server")>();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const { THREAD_JUMP_KEYBINDING_COMMANDS } = await import("@t3tools/contracts");
  // The default jump bindings are desktop-only; these hold in the browser too.
  const jumpBindings = compileResolvedKeybindingsConfig([
    ...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
      key: `mod+${index + 1}`,
      command,
    })),
    { key: "mod+alt+9", command: "terminal.toggle" },
    { key: "mod+d", command: "diff.toggle", when: "!terminalFocus" },
    { key: "mod+d", command: "composer.mode", when: "editableFocus" },
    { key: "mod+shift+m", command: "modelPicker.toggle", when: "!terminalFocus" },
    { key: "mod+shift+p", command: "thread.pin", when: "!terminalFocus" },
    { key: "mod+shift+s", command: "thread.settle", when: "!terminalFocus" },
    { key: "mod+s", command: "composer.stash", when: "!terminalFocus" },
    { key: "mod+/", command: "shortcuts.show", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(jumpBindings) };
});
vi.mock("../hooks/useHandleNewThread", async (original) => {
  const actual = await original<typeof import("../hooks/useHandleNewThread")>();
  return {
    ...actual,
    useHandleNewThread: () => ({
      ...actual.useHandleNewThread(),
      activeThread: entities.activeThread,
      handleNewThread: entities.handleNewThread,
    }),
  };
});
vi.mock("../hooks/useThreadRouteTarget", () => ({
  useThreadRouteTarget: () => entities.routeTarget,
  useThreadRouteRef: () => null,
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readEnvironmentServerConfigLoaded: () => true,
  useProjects: () => entities.projects,
  useVisibleThreadShells: () => entities.threads,
  useDelegatedUnderParent: () => entities.delegatedUnderParent,
}));

function setup(state: Partial<typeof entities> = {}) {
  // Earlier browser test files share this origin's localStorage; a remembered project
  // that is not listed here hides the default "New thread in <project>" row.
  removeLocalStorageItem(LAST_USED_PROJECT_STORAGE_KEY);
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  entities.projects = state.projects ?? [];
  entities.threads = state.threads ?? [];
  entities.activeThread = state.activeThread;
  entities.routeTarget = state.routeTarget ?? null;
  entities.delegatedUnderParent = state.delegatedUnderParent ?? new Set();
  entities.handleNewThread.mockClear();
}

const makeThreads = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    makeThreadFixture({
      environmentId: EnvironmentId.make("local"),
      id: ThreadId.make(`scale-thread-${index}`),
      title: `Scale thread ${index}`,
    }),
  );

describe("CommandPalette with many threads", () => {
  it("draws no more rows than fit on screen plus overscan when 5,000 threads are listed", async () => {
    setup({ threads: makeThreads(5000) });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "Scale thread" });

    await expect.element(page.getByRole("option").first()).toBeVisible();
    const rows = document.querySelectorAll('[role="option"]').length;
    expect(rows, "rows in the document").toBeGreaterThan(0);
    // The list is about six rows tall, with 400px of overscan at 40px a row.
    expect(rows, "rows in the document").toBeLessThanOrEqual(30);
  });

  it("does not rebuild the thread items when a letter is typed", async () => {
    setup({ threads: makeThreads(600) });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({});
    await expect.element(page.getByRole("option").first()).toBeVisible();
    const built = builds.count;

    await userEvent.keyboard("sc");

    await expect
      .element(page.getByPlaceholder("Search commands, projects, and threads..."))
      .toHaveValue("sc");
    await expect.element(page.getByRole("option").first()).toBeVisible();
    expect(builds.count).toBe(built);
  });

  it("does not rebuild the thread items when the palette is opened a second time", async () => {
    setup({ threads: makeThreads(600) });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({});
    await expect.element(page.getByRole("option").first()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("option").first()).not.toBeInTheDocument();
    const built = builds.count;

    openCommandPalette({});
    await expect.element(page.getByRole("option").first()).toBeVisible();

    expect(builds.count).toBe(built);
  });

  /** What the page held the first moment the palette's field existed. */
  function firstSightOfField() {
    const seen: { rows: number; input: Element; focused: boolean }[] = [];
    const watcher = new MutationObserver(() => {
      const input = document.querySelector('[data-slot="command-dialog-popup"] input');
      if (!input || seen.length > 0) return;
      seen.push({
        rows: document.querySelectorAll('[role="option"]').length,
        input,
        focused: document.activeElement === input,
      });
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    return { seen, [Symbol.dispose]: () => watcher.disconnect() };
  }

  it("paints the dialog and its field before the result rows, and keeps focus in the field when the rows mount", async () => {
    setup({ threads: makeThreads(600) });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    using sight = firstSightOfField();

    openCommandPalette({});
    await expect.element(page.getByRole("option").first()).toBeVisible();

    const [first] = sight.seen;
    expect(first?.rows, "rows when the field first appeared").toBe(0);
    const input = document.querySelector('[data-slot="command-dialog-popup"] input');
    expect(input, "the same field, not a replacement").toBe(first?.input);
    expect(document.activeElement, "focus stayed in the field").toBe(input);
  });

  it("keeps the text typed before the rows mount, and the rows match it", async () => {
    setup({ threads: makeThreads(600) });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({});
    const field = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("Scale thread 59");

    await expect.element(page.getByRole("option").first()).toBeVisible();
    await expect.element(field).toHaveValue("Scale thread 59");
    await expect
      .element(page.getByRole("option", { name: /Scale thread 59/ }).first())
      .toBeVisible();
  });
});
