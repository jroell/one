import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import {
  dispatchCommandPalette,
  useCommandPaletteMount,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { useShortcutsDialogStore } from "../components/shortcuts/shortcutsDialogStore";
import { completePaletteClose } from "./afterPaletteClose";
import { installCommandPaletteCommands } from "./commandPaletteCommands";
import { registerCommandHandlers } from "./commandRegistry";
import { setActiveThreadKeyReader } from "./paletteRunScope";
import { runCommandFromPalette } from "./runCommand";

const keybindings = compileResolvedKeybindingsConfig([
  { key: "mod+k", command: "commandPalette.toggle" },
  { key: "mod+/", command: "shortcuts.show" },
]);

function MountedPalette() {
  useCommandPaletteMount();
  return null;
}

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("command palette shortcuts", () => {
  it("stay inert on routes without the palette", async () => {
    setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(null, { router: "/pair" });
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );

    await userEvent.keyboard("{Control>}k{/Control}");

    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it("open the palette while it is mounted, and it closes when it unmounts", async () => {
    setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<MountedPalette />, { router: "/" });
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(useCommandPaletteStore.getState().open).toBe(true);

    await screen.rerender(<div />);
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it("show the shortcuts sheet, closing the palette first, and hide it on a second press", async () => {
    setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<MountedPalette />, { router: "/" });
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );
    dispatchCommandPalette({ _tag: "SetOpen", open: true });

    await userEvent.keyboard("{Control>}/{/Control}");
    await vi.waitFor(() => expect(useShortcutsDialogStore.getState().open).toBe(true));
    expect(useCommandPaletteStore.getState().open).toBe(false);

    await userEvent.keyboard("{Control>}/{/Control}");
    await vi.waitFor(() => expect(useShortcutsDialogStore.getState().open).toBe(false));
  });

  it("keep a child search open on a composing Escape", async () => {
    setup();
    await using screen = await render(
      <>
        <MountedPalette />
        <input aria-label="Search files" />
      </>,
      { router: "/" },
    );
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );
    dispatchCommandPalette({ _tag: "ToggleMode", mode: "files" });
    const input = page.getByRole("textbox", { name: "Search files" });
    await input.fill("にほん");

    for (const composition of [
      { key: "Escape", isComposing: true, keyCode: 27 },
      { key: "Escape", isComposing: false, keyCode: 229 },
    ]) {
      const event = new KeyboardEvent("keydown", {
        ...composition,
        bubbles: true,
        cancelable: true,
      });
      input.element().dispatchEvent(event);
      expect(event.defaultPrevented, JSON.stringify(composition)).toBe(false);
      expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "files" });
      await expect.element(input).toHaveValue("にほん");
      await expect.element(input).toHaveFocus();
    }

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    });
    input.element().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("keeps a child search open on a repeated Escape", async () => {
    setup();
    await using screen = await render(
      <>
        <MountedPalette />
        <input aria-label="Search files" />
      </>,
      { router: "/" },
    );
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );
    dispatchCommandPalette({ _tag: "ToggleMode", mode: "files" });
    const input = page.getByRole("textbox", { name: "Search files" });
    await input.click();

    const repeatEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      keyCode: 27,
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    input.element().dispatchEvent(repeatEscape);
    expect(repeatEscape.defaultPrevented).toBe(true);
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "files" });

    const freshEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      keyCode: 27,
      repeat: false,
      bubbles: true,
      cancelable: true,
    });
    input.element().dispatchEvent(freshEscape);
    expect(freshEscape.defaultPrevented).toBe(true);
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "command" });
  });
});

describe("openCommandPalette", () => {
  it("drops a request made while no palette is mounted", async () => {
    setup();
    await using screen = await render(null, { router: "/pair" });

    openCommandPalette({ open: "new-thread-in" });
    await screen.rerender(<MountedPalette />);
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: false, openIntent: null });

    openCommandPalette({ open: "new-thread-in" });
    expect(useCommandPaletteStore.getState()).toMatchObject({
      open: true,
      openIntent: { kind: "new-thread-in" },
    });
  });
});

describe("a command run from a palette row while the palette is still closing", () => {
  // Stands in for the popup that is animating out: `[data-command-palette]` is on screen until it leaves.
  function startClosing(stack: DisposableStack) {
    const popup = document.body.appendChild(document.createElement("div"));
    popup.setAttribute("data-command-palette", "true");
    stack.defer(() => popup.remove());
    return popup;
  }

  async function setupQueued() {
    setup();
    const stack = new DisposableStack();
    const run = vi.fn();
    const thread = { key: "env:thread-a" };
    stack.defer(registerCommandHandlers({ "terminal.toggle": { run } }));
    stack.defer(setActiveThreadKeyReader(() => thread.key));
    const original = window.location.href;
    stack.defer(() => window.history.replaceState({}, "", original));
    const screen = await render(<MountedPalette />, { router: "/" });
    const popup = startClosing(stack);
    await runCommandFromPalette("terminal.toggle", "Toggle terminal");
    return {
      run,
      thread,
      popup,
      screen,
      [Symbol.asyncDispose]: async () => {
        stack.dispose();
        await screen[Symbol.asyncDispose]();
      },
    };
  }

  it("runs once the popup has left when nothing changed", async () => {
    await using queued = await setupQueued();
    expect(queued.run).not.toHaveBeenCalled();

    completePaletteClose();

    expect(queued.run).toHaveBeenCalledOnce();
  });

  it("is dropped when the thread changes before the popup has left", async () => {
    await using queued = await setupQueued();

    queued.thread.key = "env:thread-b";
    completePaletteClose();

    expect(queued.run).not.toHaveBeenCalled();
  });

  it("is dropped when the route changes before the popup has left", async () => {
    await using queued = await setupQueued();

    window.history.pushState({}, "", `${window.location.pathname}?back=1`);
    completePaletteClose();

    expect(queued.run).not.toHaveBeenCalled();
  });

  it("is dropped when the palette unmounts before the popup has left", async () => {
    await using queued = await setupQueued();

    await queued.screen.rerender(<div />);
    completePaletteClose();

    expect(queued.run).not.toHaveBeenCalled();
  });
});
