import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { trackSettingsControlKind } from "./settingsControlKind";

function Cell({ initial }: { readonly initial: "none" | "select" | "picker" }) {
  const [kind, setKind] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setKind("picker")}>
        Show picker
      </button>
      <div data-settings-control="" data-testid="cell" ref={trackSettingsControlKind}>
        {kind === "select" ? <button data-slot="select-trigger">Choose</button> : null}
        {kind === "picker" ? (
          <div>
            <button type="button">
              <span data-chat-provider-model-picker-label="">Model</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

const cell = () => document.querySelector<HTMLElement>('[data-testid="cell"]')!;

describe("settings control kind", () => {
  it("marks a select as a fixed-width column and not as a chip picker", async () => {
    await using _screen = await render(<Cell initial="select" />, { router: false });
    expect(cell().hasAttribute("data-fixed")).toBe(true);
    expect(cell().hasAttribute("data-chips")).toBe(false);
  });

  it("marks nothing for a control that is neither, and both once a chip picker appears", async () => {
    await using _screen = await render(<Cell initial="none" />, { router: false });
    expect(cell().hasAttribute("data-fixed")).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "Show picker" }));
    await expect.poll(() => cell().hasAttribute("data-chips")).toBe(true);
    expect(cell().hasAttribute("data-fixed")).toBe(true);
  });
});
