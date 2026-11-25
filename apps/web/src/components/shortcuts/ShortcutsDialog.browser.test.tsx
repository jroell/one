import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useCommandPaletteMount } from "../../commandPaletteStore";
import { registerCommands } from "../../shortcuts/dispatcher";
import { installCommandPaletteCommands } from "../../shortcuts/commandPaletteCommands";
import { ShortcutsDialogHost } from "./ShortcutsDialog";
import {
  setShortcutsDialogOpen,
  toggleShortcutsDialog,
  useShortcutsDialogStore,
} from "./shortcutsDialogStore";

const keybindings = compileResolvedKeybindingsConfig([
  { key: "mod+shift+s", command: "thread.settle" },
  { key: "mod+/", command: "shortcuts.show" },
]);

function Host() {
  useCommandPaletteMount();
  return <ShortcutsDialogHost />;
}

describe("keyboard shortcuts sheet", () => {
  it("leaves app shortcuts alone while open, closes on its own key and on Escape", async () => {
    setShortcutsDialogOpen(false);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const settle = vi.fn((event: KeyboardEvent) => event.preventDefault());
    await using screen = await render(<Host />, { router: "/" });
    using scopes = new DisposableStack();
    scopes.defer(installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }));
    scopes.defer(registerCommands({ "thread.settle": settle }, { keybindings: () => keybindings }));

    await userEvent.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(settle).toHaveBeenCalledOnce();

    setShortcutsDialogOpen(true);
    const filter = page.getByRole("searchbox", { name: "Filter shortcuts" });
    await expect.element(filter).toHaveFocus();
    await userEvent.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    await userEvent.type(filter, "settle");
    await expect.element(filter).toHaveValue("settle");
    expect(settle).toHaveBeenCalledOnce();

    await userEvent.keyboard("{Control>}/{/Control}");
    await expect.element(filter).not.toBeInTheDocument();
    expect(useShortcutsDialogStore.getState().open).toBe(false);

    setShortcutsDialogOpen(true);
    await expect.element(page.getByRole("searchbox", { name: "Filter shortcuts" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("searchbox", { name: "Filter shortcuts" }))
      .not.toBeInTheDocument();
    expect(settle).toHaveBeenCalledOnce();
  });

  it("opens over Settings but not over another dialog", async () => {
    setShortcutsDialogOpen(false);
    await using screen = await render(
      <>
        <Host />
        <div role="dialog" aria-label="Rename thread" />
      </>,
      { router: "/" },
    );

    toggleShortcutsDialog();
    expect(useShortcutsDialogStore.getState().open).toBe(false);

    await screen.rerender(
      <>
        <Host />
        <div role="dialog" aria-label="Settings" data-app-modal="" />
      </>,
    );
    toggleShortcutsDialog();
    expect(useShortcutsDialogStore.getState().open).toBe(true);
    setShortcutsDialogOpen(false);
  });
});
