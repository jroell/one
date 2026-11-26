import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { textContrast } from "../../../test/contrast";
import { render } from "../../../test/render";
import { useCommandPaletteMount } from "../../commandPaletteStore";
import { ShortcutsDialogHost } from "./ShortcutsDialog";
import { setShortcutsDialogOpen } from "./shortcutsDialogStore";

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(DEFAULT_RESOLVED_KEYBINDINGS) };
});

function Host() {
  useCommandPaletteMount();
  return <ShortcutsDialogHost />;
}

describe("keyboard shortcuts sheet with the default shortcuts", () => {
  it("lists Approve and Decline under an Approval heading, with a condition written as a plain phrase", async () => {
    setShortcutsDialogOpen(true);
    await using _screen = await render(<Host />, { router: "/" });
    const approval = page.getByRole("region", { name: "Approval" });
    await expect.element(approval).toBeVisible();
    const labels = [...approval.element().querySelectorAll("li")].map((row) => row.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^Approve/);
    expect(labels[1]).toMatch(/^Decline/);
    // No variable names: the old copy read "with terminalOpen".
    expect(document.body.textContent).not.toMatch(/terminalOpen|modelPickerOpen|turnRunning|isMac/);
    setShortcutsDialogOpen(false);
  });

  it.each(["light", "dark"] as const)(
    "wraps a long condition instead of cutting it off, and draws it at least 4.5:1 in %s",
    async (scheme) => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      document.body.style.backgroundColor =
        scheme === "dark" ? "rgb(10 10 10)" : "rgb(255 255 255)";
      try {
        setShortcutsDialogOpen(true);
        await using _screen = await render(<Host />, { router: "/" });
        const row = page.getByRole("region", { name: "Thread" }).element().querySelector("li")!;
        const qualifier = row.querySelector<HTMLElement>("span span:nth-child(2)")!;
        expect(qualifier.textContent).toMatch(/when the model picker is closed/);
        expect(getComputedStyle(qualifier).textOverflow).not.toBe("ellipsis");
        expect(getComputedStyle(qualifier).whiteSpace).toBe("normal");
        expect(textContrast(qualifier)).toBeGreaterThanOrEqual(4.5);
      } finally {
        document.documentElement.classList.remove("dark");
        document.body.style.backgroundColor = "";
        setShortcutsDialogOpen(false);
      }
    },
  );
});
