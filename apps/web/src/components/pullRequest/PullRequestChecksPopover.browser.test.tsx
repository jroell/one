import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";

describe("the checks icon in a pull request row", () => {
  it("names what it shows when hovered, and still opens the checks when clicked", async () => {
    await using screen = await render(
      <PullRequestChecksPopover
        checksState="passing"
        checks={[
          {
            name: "lint",
            status: "success",
            url: null,
            workflow: null,
            description: null,
          } as never,
        ]}
      />,
      { router: false },
    );
    const icon = screen.getByRole("button", { name: "Checks: All checks have passed" });
    await userEvent.hover(icon);
    // The tooltip repeats the name the icon already carries for assistive technology.
    await vi.waitFor(() => {
      const popup = document.querySelector('[data-slot="tooltip-popup"]');
      expect(popup?.textContent).toBe("Checks: All checks have passed");
    });
    await userEvent.click(icon);
    await expect.element(page.getByText("lint")).toBeVisible();
  });
});
