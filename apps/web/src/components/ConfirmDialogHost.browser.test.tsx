import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import {
  destructiveConfirm,
  requestConfirmDialog,
  resetConfirmDialogForTests,
} from "~/confirmDialog";
import { act, render } from "../../test/render";
import { ConfirmDialogHost } from "./ConfirmDialogHost";

it("names the destructive action on the confirm button and keeps Cancel focused", async () => {
  resetConfirmDialogForTests();
  await using _screen = await render(<ConfirmDialogHost />);
  let confirmation: Promise<boolean> | undefined;
  await act(() => {
    confirmation = requestConfirmDialog(
      'Delete thread "Release notes"?\nThis permanently clears conversation history for this thread.',
      destructiveConfirm("Delete thread"),
    );
  });

  expect(page.getByRole("button", { name: "Confirm", exact: true }).query()).toBeNull();
  await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
  await expect
    .element(page.getByRole("button", { name: "Delete thread", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Tab}{Enter}");
  await expect(confirmation).resolves.toBe(true);
});
