import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AlertDialog, AlertDialogPopup, AlertDialogTitle } from "./alert-dialog";
import { Dialog, DialogPopup, DialogTitle } from "./dialog";
import { Sheet, SheetPopup, SheetTitle } from "./sheet";

/** A button opens a dialog whose first field takes focus with React's autoFocus as it mounts. */
function AutoFocusDialog({ removeOpener = false }: { readonly removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  return (
    <div aria-label="Toolbar" role="toolbar" tabIndex={0}>
      {showOpener ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (removeOpener) setShowOpener(false);
          }}
        >
          Open
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>Rename</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
          >
            <input aria-label="Name" autoFocus />
            <button type="submit">Save</button>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

const opener = () => page.getByRole("button", { name: "Open", exact: true });

describe("focus after a dialog closes", () => {
  it("returns to the button that opened a dialog whose first field uses autoFocus, on Escape", async () => {
    await using _screen = await render(<AutoFocusDialog />, { router: false });
    await userEvent.click(opener());
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect.element(opener()).toHaveFocus();
  });

  it("returns to the opener when the close button is pressed", async () => {
    await using _screen = await render(<AutoFocusDialog />, { router: false });
    await userEvent.click(opener());
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();

    // A press on the close button, with the keyboard: pointer actions cannot reach it in the
    // test browser, which covers the dialog's top corner with its focus guard.
    page.getByRole("button", { name: "Close" }).element().focus();
    await userEvent.keyboard("{Enter}");

    await expect.element(opener()).toHaveFocus();
  });

  it("returns to the opener after a successful submit", async () => {
    await using _screen = await render(<AutoFocusDialog />, { router: false });
    await userEvent.click(opener());
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    await expect.element(opener()).toHaveFocus();
  });

  it("goes to the nearest focusable element around the opener when the opener unmounted while the dialog was open", async () => {
    await using _screen = await render(<AutoFocusDialog removeOpener />, { router: false });
    // The opener removes itself as it is pressed, which a pointer action cannot wait out.
    opener().element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect.element(page.getByRole("toolbar", { name: "Toolbar" })).toHaveFocus();
  });

  it("does the same for a sheet and an alert dialog", async () => {
    function Others() {
      const [sheet, setSheet] = useState(false);
      const [alert, setAlert] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setSheet(true)}>
            Open sheet
          </button>
          <button type="button" onClick={() => setAlert(true)}>
            Open alert
          </button>
          <Sheet open={sheet} onOpenChange={setSheet}>
            <SheetPopup>
              <SheetTitle>Panel</SheetTitle>
              <input aria-label="Sheet field" autoFocus />
            </SheetPopup>
          </Sheet>
          <AlertDialog open={alert} onOpenChange={setAlert}>
            <AlertDialogPopup>
              <AlertDialogTitle>Sure?</AlertDialogTitle>
              <input aria-label="Alert field" autoFocus />
            </AlertDialogPopup>
          </AlertDialog>
        </>
      );
    }
    await using _screen = await render(<Others />, { router: false });

    await userEvent.click(page.getByRole("button", { name: "Open sheet" }));
    await expect.element(page.getByRole("textbox", { name: "Sheet field" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "Open sheet" })).toHaveFocus();

    await userEvent.click(page.getByRole("button", { name: "Open alert" }));
    await expect.element(page.getByRole("textbox", { name: "Alert field" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "Open alert" })).toHaveFocus();
  });
});
