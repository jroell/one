import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarChromeFooter } from "./SidebarChrome";

vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([{ key: "mod+u", command: "usage.open" }]),
    ),
  };
});

describe("sidebar footer tooltips", () => {
  it("show the live key of the Usage shortcut", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using _screen = await render(
      <SidebarProvider>
        <SidebarChromeFooter />
      </SidebarProvider>,
    );

    await userEvent.hover(page.getByRole("button", { name: "Usage" }));

    await expect.element(page.getByText("Usage (Ctrl+U)")).toBeVisible();
  });
});
