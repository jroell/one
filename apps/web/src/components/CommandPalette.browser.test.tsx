import { threadKey } from "@t3tools/client-runtime/state/entities";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { setShortcutsDialogOpen, useShortcutsDialogStore } from "./shortcuts/shortcutsDialogStore";
import { dispatchCommandPalette, useCommandPaletteStore } from "../commandPaletteStore";
import { LAST_USED_PROJECT_STORAGE_KEY } from "../hooks/useHandleNewThread";
import { removeLocalStorageItem } from "../hooks/useLocalStorage";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import { registerCommandHandlers } from "../shortcuts/commandRegistry";
import type { ThreadRouteTarget } from "../threadRoutes";
import { CommandPalette } from "./CommandPalette";

const entities = vi.hoisted(() => ({
  projects: [] as ReadonlyArray<Project>,
  threads: [] as ReadonlyArray<Thread>,
  activeThread: undefined as Thread | undefined,
  routeTarget: null as ThreadRouteTarget | null,
  delegatedUnderParent: new Set<string>() as ReadonlySet<string>,
  useRealNewThread: false,
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
    useHandleNewThread: () => {
      const result = actual.useHandleNewThread();
      return {
        ...result,
        activeThread: entities.activeThread,
        handleNewThread: entities.useRealNewThread
          ? result.handleNewThread
          : entities.handleNewThread,
      };
    },
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
  entities.useRealNewThread = state.useRealNewThread ?? false;
  entities.handleNewThread.mockClear();
}

function makeProject(title: string): Project {
  return {
    id: ProjectId.make(title),
    environmentId: EnvironmentId.make("local"),
    title,
    workspaceRoot: `/work/${title}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("CommandPalette open intents", () => {
  it("opens a new draft in the current project from an empty command palette search", async () => {
    const project = makeProject("Acme no matches");
    setup({
      useRealNewThread: true,
      projects: [project],
      activeThread: makeThreadFixture({
        projectId: project.id,
        environmentId: project.environmentId,
      }),
    });
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "zzz999nomatchzzz" });
    await page.getByRole("option", { name: "New thread in Acme no matches" }).click();

    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.router!.state.location.pathname).toMatch(/^\/draft\/[^/]+$/),
    );
    const draftId = DraftId.make(screen.router!.state.location.pathname.slice("/draft/".length));
    const drafts = useComposerDraftStore.getState();
    using _draft = { [Symbol.dispose]: () => drafts.clearDraftThread(draftId) };
    expect(drafts.getDraftSession(draftId)).toMatchObject({
      environmentId: project.environmentId,
      projectId: project.id,
    });
  });

  it("drags a searched thread into the current composer without navigating", async () => {
    const environmentId = EnvironmentId.make("remote");
    const threadId = ThreadId.make("dragged-thread");
    setup({
      threads: [makeThreadFixture({ environmentId, id: threadId, title: "Drag this thread" })],
    });
    const onDrop = vi.fn();
    await using screen = await render(
      <CommandPalette>
        <div
          data-thread-context-drop="true"
          ref={(node) => {
            node?.addEventListener("t3-thread-context-drop", onDrop);
          }}
          style={{ position: "fixed", bottom: 0, width: 300, height: 100 }}
        >
          Composer
        </div>
      </CommandPalette>,
    );
    const pathname = screen.router?.state.location.pathname;
    openCommandPalette({ query: "Drag this thread" });
    const row = page.getByRole("option", { name: /Drag this thread/ });
    await expect.element(row).toBeVisible();
    const bounds = row.element().getBoundingClientRect();
    const pointer = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      });
    await act(() => {
      row.element().dispatchEvent(pointer("pointerdown", bounds.x + 20, bounds.y + 10));
      document.dispatchEvent(pointer("pointermove", bounds.x + 30, bounds.y + 20));
    });
    expect(useCommandPaletteStore.getState().open).toBe(false);
    await act(() => {
      document.dispatchEvent(pointer("pointermove", 50, window.innerHeight - 30));
      document.dispatchEvent(pointer("pointerup", 50, window.innerHeight - 30));
    });
    expect(onDrop).toHaveBeenCalledOnce();
    expect((onDrop.mock.calls[0]![0] as CustomEvent).detail).toEqual([
      { environmentId, threadId, title: "Drag this thread" },
    ]);
    expect(screen.router?.state.location.pathname).toBe(pathname);
  });

  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("highlights the first project when New thread in... opens from the root list", async () => {
    const environmentId = EnvironmentId.make("local");
    const project = (id: string, title: string): Project => ({
      id: ProjectId.make(id),
      environmentId,
      title,
      workspaceRoot: `/work/${id}`,
      repositoryIdentity: null,
      defaultModelSelection: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      scripts: [],
    });
    setup({
      projects: [project("acme", "Acme"), project("beta", "Beta"), project("gamma", "Gamma")],
    });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({});
    await expect
      .element(page.getByPlaceholder("Search commands, projects, and threads..."))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option", { name: /^New thread in\.\.\./ }))
      .toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
    await expect.element(page.getByRole("option").first()).toHaveAttribute("data-highlighted");
    await expect.element(page.getByRole("option").nth(1)).not.toHaveAttribute("data-highlighted");
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("opens a searched project's latest listed thread, not a newer subagent, delegated task, or parked thread", async () => {
    const environmentId = EnvironmentId.make("local");
    const projectId = ProjectId.make("acme");
    const parentId = ThreadId.make("parent");
    const delegatedId = ThreadId.make("delegated");
    setup({
      delegatedUnderParent: new Set([threadKey({ environmentId, threadId: delegatedId })]),
      projects: [
        {
          id: projectId,
          environmentId,
          title: "Acme",
          workspaceRoot: "/work/acme",
          repositoryIdentity: null,
          defaultModelSelection: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          scripts: [],
        },
      ],
      threads: [
        makeThreadFixture({
          id: parentId,
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-02T00:00:00.000Z",
        }),
        makeThreadFixture({
          id: ThreadId.make("subagent"),
          environmentId,
          projectId,
          updatedAt: "2026-03-03T00:00:00.000Z",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
        makeThreadFixture({
          id: delegatedId,
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-04T00:00:00.000Z",
        }),
        makeThreadFixture({
          id: ThreadId.make("settled"),
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-05T00:00:00.000Z",
          settledOverride: "settled",
        }),
        makeThreadFixture({
          id: ThreadId.make("snoozed"),
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-06T00:00:00.000Z",
          snoozedUntil: "2999-01-01T00:00:00.000Z",
        }),
      ],
    });
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "Acme" });
    await page.getByRole("option", { name: /Acme/ }).first().click();

    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/parent"));
  });

  it("starts a thread in an open copy when the current project's copy is archived", async () => {
    const repositoryIdentity = {
      canonicalKey: "github.com/example/acme",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "https://github.com/example/acme.git",
      },
    };
    const archived = {
      ...makeProject("acme"),
      repositoryIdentity,
      archivedAt: "2026-03-02T00:00:00.000Z",
    };
    const open = {
      ...makeProject("acme"),
      environmentId: EnvironmentId.make("remote"),
      repositoryIdentity,
    };
    setup({
      projects: [archived, open],
      activeThread: makeThreadFixture({
        environmentId: archived.environmentId,
        projectId: archived.id,
      }),
    });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });
    await page.getByRole("option", { name: /acme/i }).click();

    await vi.waitFor(() =>
      expect(entities.handleNewThread).toHaveBeenCalledWith({
        environmentId: open.environmentId,
        projectId: open.id,
      }),
    );
  });

  it("numbers filtered New thread in... rows from 1 and jumps to them", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    setup({ projects: [makeProject("server"), makeProject("lima")] });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });
    await userEvent.fill(page.getByPlaceholder("Search..."), "li");
    await expect.element(page.getByRole("option", { name: /server/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: /lima/ })).toMatchTextContent("Ctrl+1");
    await userEvent.keyboard("{Control>}1{/Control}");

    await vi.waitFor(() =>
      expect(entities.handleNewThread).toHaveBeenCalledWith({
        environmentId: EnvironmentId.make("local"),
        projectId: ProjectId.make("lima"),
      }),
    );
  });

  it("leaves a submenu only on a fresh, unmodified Backspace", async () => {
    setup({ projects: [makeProject("Acme"), makeProject("Beta")] });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({});
    const rootInput = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(rootInput).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option", { name: /^New thread in\.\.\./ }))
      .toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");

    const submenuInput = page.getByPlaceholder("Search...");
    await expect.element(submenuInput).toHaveFocus();

    for (const init of [
      { repeat: true },
      { ctrlKey: true },
      { isComposing: true },
    ] satisfies ReadonlyArray<KeyboardEventInit>) {
      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      await act(() => submenuInput.element().dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      await expect.element(submenuInput).toBeVisible();
    }

    await userEvent.keyboard("{Backspace}");
    await expect.element(rootInput).toHaveFocus();
  });

  it("ignores repeated Escape keydowns after stepping back from file search", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({});
    const palette = page.getByTestId("command-palette");
    await expect.element(palette).toHaveAttribute("data-palette-mode", "command");

    await act(() => {
      dispatchCommandPalette({
        _tag: "OpenChildSearch",
        mode: "files",
        context: { query: "", linkedThreadSearch: null },
      });
    });
    await expect.element(palette).toHaveAttribute("data-palette-mode", "files");

    await userEvent.keyboard("{Escape}");
    await expect.element(palette).toHaveAttribute("data-palette-mode", "command");
    await expect
      .element(page.getByPlaceholder("Search commands, projects, and threads..."))
      .toHaveFocus();

    await act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useCommandPaletteStore.getState().open).toBe(true);
    await expect.element(palette).toHaveAttribute("data-palette-mode", "command");

    await userEvent.keyboard("{Escape}");
    await expect.element(palette).not.toBeInTheDocument();
  });
});

describe("CommandPalette commands", () => {
  function openThread() {
    const thread = makeThreadFixture({
      environmentId: EnvironmentId.make("local"),
      id: ThreadId.make("open-thread"),
    });
    return {
      activeThread: thread,
      routeTarget: {
        kind: "server",
        threadRef: { environmentId: thread.environmentId, threadId: thread.id },
      } satisfies ThreadRouteTarget,
    };
  }
  const searchInput = () => page.getByPlaceholder("Search commands, projects, and threads...");

  it("finds the panel, thread and branch commands by name, with their live keys", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    setup(openThread());
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    using _handlers = new DisposableStack();
    _handlers.defer(
      registerCommandHandlers({
        "terminal.toggle": { run: vi.fn() },
        "diff.toggle": { run: vi.fn() },
        "modelPicker.toggle": { run: vi.fn() },
      }),
    );
    openCommandPalette({});

    for (const [query, title, keys] of [
      ["diff", "Toggle diff panel", "Ctrl+D"],
      ["term", "Toggle terminal", "Ctrl+Alt+9"],
      ["model", "Open model picker", "Ctrl+Shift+M"],
      ["pin", "Pin thread", "Ctrl+Shift+P"],
      ["settle", "Settle thread", "Ctrl+Shift+S"],
      ["snooze", "Snooze$", null],
    ] as const) {
      await userEvent.fill(searchInput(), query);
      const row = page.getByRole("option", { name: new RegExp(`^${title}`) });
      await expect.element(row).toBeVisible();
      if (keys !== null) await expect.element(row).toMatchTextContent(keys);
    }
  });

  it("hides thread commands where no thread is open", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({});

    await userEvent.fill(searchInput(), "diff");
    await expect
      .element(page.getByRole("option", { name: /Toggle diff panel/ }))
      .not.toBeInTheDocument();
    await userEvent.fill(searchInput(), "pin thread");
    await expect.element(page.getByRole("option", { name: /^Pin thread/ })).not.toBeInTheDocument();
  });

  it("runs a keybinding result's command on Enter", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    setup(openThread());
    const stash = vi.fn();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    using _handlers = new DisposableStack();
    _handlers.defer(registerCommandHandlers({ "composer.stash": { run: stash } }));
    openCommandPalette({ query: "Composer: stash" });

    const row = page.getByRole("option", { name: /^Composer: stash/ });
    await expect.element(row).toMatchTextContent("Runs this command");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(stash).toHaveBeenCalledOnce());
  });

  it("runs Toggle diff panel by id when its key means another command with the composer focused", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    setup(openThread());
    const stateWhenRun: string[] = [];
    const toggleDiff = vi.fn(() => {
      stateWhenRun.push(
        `${document.querySelector("[data-command-palette]") ? "palette on screen" : "palette gone"}, focus in ${document.activeElement?.getAttribute("aria-label")}`,
      );
    });
    const composerMode = vi.fn();
    await using _screen = await render(
      <CommandPalette>
        <textarea aria-label="Message" />
      </CommandPalette>,
    );
    using _handlers = new DisposableStack();
    _handlers.defer(
      registerCommandHandlers({
        "diff.toggle": { run: toggleDiff },
        "composer.mode": { run: composerMode },
      }),
    );
    await page.getByRole("textbox", { name: "Message" }).click();
    openCommandPalette({});
    await userEvent.fill(searchInput(), "diff");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(toggleDiff).toHaveBeenCalledOnce());
    expect(composerMode).not.toHaveBeenCalled();
    await expect.element(page.getByRole("textbox", { name: "Message" })).toHaveFocus();
    expect(stateWhenRun).toEqual(["palette gone, focus in Message"]);
  });

  it("runs a command that has no key bound from its row", async () => {
    setup(openThread());
    const toggleRightPanel = vi.fn();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    using _handlers = new DisposableStack();
    _handlers.defer(registerCommandHandlers({ "rightPanel.toggle": { run: toggleRightPanel } }));
    openCommandPalette({});
    await userEvent.fill(searchInput(), "right panel");

    const row = page.getByRole("option", { name: /^Toggle right panel/ });
    await expect.element(row).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(toggleRightPanel).toHaveBeenCalledOnce());
  });

  it("disables a row whose command cannot run, and leaves it out when only a chat has it", async () => {
    setup(openThread());
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    using _handlers = new DisposableStack();
    _handlers.defer(
      registerCommandHandlers({
        "diff.toggle": { run: vi.fn(), canRun: () => false },
        "view.reopenClosed": { run: vi.fn(), canRun: () => false },
      }),
    );
    openCommandPalette({});

    await userEvent.fill(searchInput(), "diff");
    await expect
      .element(page.getByRole("option", { name: /Toggle diff panel/ }))
      .not.toBeInTheDocument();
    await userEvent.fill(searchInput(), "reopen");
    await expect.element(page.getByText("Reopen closed tab")).toBeVisible();
    await expect.element(page.getByText("Not available")).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /^Reopen closed tab/ }))
      .not.toBeInTheDocument();
  });

  it("runs a row once when Enter arrives twice before the palette has closed", async () => {
    setup({ projects: [makeProject("acme")] });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({ open: "new-thread-in" });
    await expect.element(page.getByRole("option", { name: /acme/ })).toBeVisible();

    const input = page.getByPlaceholder("Search...").element();
    for (let press = 0; press < 2; press += 1) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    }

    await vi.waitFor(() => expect(entities.handleNewThread).toHaveBeenCalled());
    await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
    expect(entities.handleNewThread).toHaveBeenCalledOnce();
  });

  it("sends a keybinding result to its setting when no chat can run it", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({ query: "Composer: stash" });

    await expect
      .element(page.getByRole("option", { name: /^Composer: stash/ }))
      .toMatchTextContent("Settings · Keyboard shortcuts");
  });

  it("tells the shortcuts sheet and the shortcuts settings apart, and each opens its own destination", async () => {
    setup(openThread());
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({ query: "keyboard shortcuts" });

    const sheet = page.getByRole("option", { name: /^Show keyboard shortcuts/ });
    const settings = page.getByRole("option", { name: /^Edit keyboard shortcuts/ });
    await expect.element(sheet).toBeVisible();
    await expect.element(settings).toMatchTextContent("Edit shortcuts in Settings");

    await userEvent.click(settings);
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe("/settings/keybindings"),
    );
    expect(useShortcutsDialogStore.getState().open).toBe(false);

    openCommandPalette({ query: "keyboard shortcuts" });
    await userEvent.click(page.getByRole("option", { name: /^Show keyboard shortcuts/ }));
    await vi.waitFor(() => expect(useShortcutsDialogStore.getState().open).toBe(true));
    setShortcutsDialogOpen(false);
  });

  it("opens the shortcuts sheet from its row with the filter focused, and Escape closes it", async () => {
    setup(openThread());
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({ query: "keyboard shortcuts" });
    await expect
      .element(page.getByRole("option", { name: /^Show keyboard shortcuts/ }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");

    const filter = page.getByRole("searchbox", { name: "Filter shortcuts" });
    await expect.element(filter).toHaveFocus();
    // A custom key for a command that ships with another one.
    await expect.element(page.getByText("Terminal: toggle")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(filter).not.toBeInTheDocument();
  });
});
