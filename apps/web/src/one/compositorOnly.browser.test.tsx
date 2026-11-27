import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { ComposerSurface } from "../components/chat/ComposerSurface";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Command, CommandDialog, CommandDialogPopup, CommandInput } from "../components/ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { ToastProvider, toastManager } from "../components/ui/toast";
import { offContractAnimations } from "../../test/animationGuard";
import { act, render } from "../../test/render";

// Every animation or transition that is running in a main state must change only what the
// compositor can move: opacity, transform, rotate, scale, translate. Anything else repaints the
// element on every frame. An exception goes in `ALLOWED` with the reason it may stay.
const ALLOWED: Readonly<Record<string, string>> = {};

const off = () => offContractAnimations(ALLOWED);

function SheetScene() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup>
          <SheetTitle>Panel</SheetTitle>
        </SheetPopup>
      </Sheet>
    </>
  );
}

describe("main states animate only what the compositor can move", () => {
  it("composer focus: the focus edge fades in by opacity and no shadow animates", async () => {
    await using _screen = await render(
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <textarea aria-label="Message" />
        </ComposerSurface.Host>
      </ComposerSurface.Shell>,
      { router: false },
    );

    await userEvent.click(page.getByRole("textbox", { name: "Message" }));
    const glow = document.querySelector<HTMLElement>(".one-composer-glow")!;
    const running = glow.getAnimations();

    expect(running.length, "the focus edge is animating").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
    const host = document.querySelector<HTMLElement>('[data-slot="composer-host"]')!;
    expect(
      getComputedStyle(host).transitionProperty,
      "the host no longer transitions its shadow",
    ).not.toContain("box-shadow");
  });

  it("a turn working: the rim light turns by rotate alone", async () => {
    await using _screen = await render(
      <div data-one-working="">
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <textarea aria-label="Message" />
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
      </div>,
      { router: false },
    );

    const orbit = document.getAnimations().filter((animation) => animation instanceof CSSAnimation);
    expect(orbit.length, "the working light is running").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
  });

  it("menu open: the popup arrives by scale and translate", async () => {
    await using _screen = await render(
      <Menu>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPopup>
          <MenuItem>One</MenuItem>
        </MenuPopup>
      </Menu>,
      { router: false },
    );

    await userEvent.click(page.getByRole("button", { name: "Open" }));
    await expect.element(page.getByRole("menuitem", { name: "One" })).toBeVisible();

    expect(document.getAnimations().length, "the popup is arriving").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
  });

  it("toast in: the toast arrives by translate and scale", async () => {
    await using _screen = await render(<ToastProvider>{null}</ToastProvider>);
    await act(async () => {
      toastManager.add({ type: "info", title: "Saved", timeout: 0 });
    });
    await expect.element(page.getByText("Saved")).toBeVisible();

    expect(document.getAnimations().length, "the toast is arriving").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
    toastManager.close();
  });

  it("palette open: the dialog arrives by scale and translate, the backdrop by opacity", async () => {
    await using _screen = await render(
      <CommandDialog open>
        <CommandDialogPopup>
          <Command>
            <CommandInput placeholder="Search" />
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
      { router: false },
    );
    await expect.element(page.getByPlaceholder("Search")).toBeVisible();

    expect(document.getAnimations().length, "the palette is arriving").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
  });

  it("dialog open: the popup arrives by scale and translate", async () => {
    await using _screen = await render(
      <Dialog open>
        <DialogPopup>
          <DialogTitle>Title</DialogTitle>
        </DialogPopup>
      </Dialog>,
      { router: false },
    );
    await expect.element(page.getByText("Title")).toBeVisible();

    expect(document.getAnimations().length, "the dialog is arriving").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
  });

  it("sheet open: the side sheet slides by translate", async () => {
    await using _screen = await render(<SheetScene />, { router: false });
    await userEvent.click(page.getByRole("button", { name: "Show" }));
    await expect.element(page.getByText("Panel")).toBeVisible();

    expect(document.getAnimations().length, "the sheet is arriving").toBeGreaterThan(0);
    expect(off(), "running animations off the compositor list").toEqual([]);
  });

  it("the guard names an animated box-shadow, so a shadow that animates again is caught", async () => {
    await using _screen = await render(
      <div id="probe" style={{ width: 40, height: 40 }}>
        probe
      </div>,
      { router: false },
    );
    const probe = document.querySelector<HTMLElement>("#probe")!;
    probe.animate([{ boxShadow: "none" }, { boxShadow: "0 0 0 4px red" }], { duration: 5000 });
    probe.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 5000 });

    expect(offContractAnimations()).toEqual([
      { target: "div", animation: "script", properties: ["boxShadow"] },
    ]);
    expect(offContractAnimations({ boxShadow: "a test of the guard" })).toEqual([]);
  });
});
