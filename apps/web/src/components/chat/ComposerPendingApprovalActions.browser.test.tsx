import { RuntimeRequestId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

it("offers Decline and Approve as buttons and names what each extra choice does", async () => {
  const respond = vi.fn().mockResolvedValue(undefined);
  await using _screen = await render(
    <ComposerPendingApprovalActions
      presentation="inline"
      requestId={RuntimeRequestId.make("approval")}
      isResponding={false}
      canRespond
      onRespondToApproval={respond}
    />,
  );

  await expect.element(page.getByRole("button", { name: "Decline", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More approval options" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Cancel the turn" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Allow for the rest of this session" }).click();
  expect(respond).toHaveBeenLastCalledWith("approval", "acceptForSession");

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  expect(respond).toHaveBeenLastCalledWith("approval", "accept");
});
