import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { CopyCommandButton } from "./CopyCommandButton";

describe("the copy button beside a command the person is told to run", () => {
  it("puts the exact command on the clipboard and says so", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      await using _screen = await render(<CopyCommandButton command="t3 up --lan" />, {
        router: false,
      });
      await userEvent.click(page.getByRole("button", { name: "Copy command" }));
      await vi.waitFor(() => expect(write).toHaveBeenCalledWith("t3 up --lan"));
      await expect.element(page.getByRole("button", { name: "Copied" })).toBeVisible();
    } finally {
      write.mockRestore();
    }
  });
});
