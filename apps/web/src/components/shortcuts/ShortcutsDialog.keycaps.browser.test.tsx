import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig: compile } = await import("@t3tools/shared/keybindings");
  const compiled = compile([
    { key: "mod+shift+arrowup", command: "thread.previous" },
    { key: "mod+enter", command: "composer.sendAndNewThread" },
    { key: "mod+f", command: "chat.find" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(compiled) };
});

import { ShortcutsDialogHost } from "./ShortcutsDialog";
import { setShortcutsDialogOpen } from "./shortcutsDialogStore";

describe("keyboard shortcuts sheet layout", () => {
  it("leaves 20px between the serif title and the filter, and sets the title in the brand serif", async () => {
    setShortcutsDialogOpen(true);
    await using _screen = await render(<ShortcutsDialogHost />, { router: "/" });
    await expect.element(page.getByRole("searchbox", { name: "Filter shortcuts" })).toBeVisible();

    const header = document.querySelector<HTMLElement>(
      "[data-shortcuts-sheet] [data-slot=dialog-header]",
    )!;
    const title = document.querySelector<HTMLElement>(
      "[data-shortcuts-sheet] [data-slot=dialog-title]",
    )!;
    expect(getComputedStyle(header).rowGap).toBe("20px");
    expect(getComputedStyle(title).fontFamily).toMatch(/Iowan|Palatino|Georgia/);
    setShortcutsDialogOpen(false);
  });

  it("lists chat commands under their own Chat heading", async () => {
    setShortcutsDialogOpen(true);
    await using _screen = await render(<ShortcutsDialogHost />, { router: "/" });
    await expect.element(page.getByRole("searchbox", { name: "Filter shortcuts" })).toBeVisible();

    const headings = [...document.querySelectorAll("[data-shortcuts-sheet] h3")].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(["Thread", "Chat", "Composer"]);
    setShortcutsDialogOpen(false);
  });
});

describe("keyboard shortcuts sheet keycaps", () => {
  it("draws arrow and Enter keys as glyphs hidden from assistive tech, with their spoken names beside them", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    setShortcutsDialogOpen(true);
    await using _screen = await render(<ShortcutsDialogHost />, { router: "/" });
    await expect.element(page.getByRole("searchbox", { name: "Filter shortcuts" })).toBeVisible();

    const rows = [...document.querySelectorAll<HTMLElement>("[data-shortcuts-sheet] li")];
    const arrowRow = rows.find((row) => row.textContent?.includes("↑"))!;
    expect(arrowRow.textContent).toContain("Up arrow");
    expect(arrowRow.querySelector('[aria-hidden="true"]')?.textContent).toBe("⇧");
    const hiddenGlyphs = [...arrowRow.querySelectorAll('[aria-hidden="true"]')].map(
      (node) => node.textContent,
    );
    expect(hiddenGlyphs).toContain("↑");
    const enterRow = rows.find((row) => row.textContent?.includes("↵"))!;
    expect(enterRow.textContent).toContain("Enter");

    await userEvent.type(page.getByRole("searchbox", { name: "Filter shortcuts" }), "up arrow");
    await expect.poll(() => document.querySelectorAll("[data-shortcuts-sheet] li").length).toBe(1);
    setShortcutsDialogOpen(false);
  });
});
