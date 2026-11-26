import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerSurface } from "./ComposerSurface";

function Harness({ detached = false }: { readonly detached?: boolean }) {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown(false)}>
        Dismiss
      </button>
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          {shown ? <ComposerBanner.Root detached={detached}>Notice</ComposerBanner.Root> : null}
          <textarea aria-label="Message" />
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </>
  );
}

const shell = () => document.querySelector<HTMLElement>('[data-slot="composer-shell"]')!;

describe("the composer shell's attached-banner state", () => {
  it("is set while an attached banner is mounted, hides the shell's own glass, and clears when the banner goes", async () => {
    await using _screen = await render(<Harness />, { router: false });
    expect(shell().hasAttribute("data-banner-attached")).toBe(true);
    expect(getComputedStyle(shell(), "::before").display).toBe("none");

    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));

    await expect.poll(() => shell().hasAttribute("data-banner-attached")).toBe(false);
    expect(getComputedStyle(shell(), "::before").display).not.toBe("none");
  });

  it("is not set by a detached banner, which is a card of its own", async () => {
    await using _screen = await render(<Harness detached />, { router: false });

    expect(shell().hasAttribute("data-banner-attached")).toBe(false);
    expect(getComputedStyle(shell(), "::before").display).not.toBe("none");
  });

  it("drops the pointer reflection on the host while a banner is attached", async () => {
    await using _screen = await render(<Harness />, { router: false });
    const reflection = document.querySelector<HTMLElement>("[data-one-reflect] > .one-reflection")!;

    expect(getComputedStyle(reflection).display).toBe("none");
  });
});
