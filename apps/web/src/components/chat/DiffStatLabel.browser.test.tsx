import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { DiffStatLabel } from "./DiffStatLabel";

it("says Binary for a binary file instead of showing +0 -0", async () => {
  await using screen = await render(<DiffStatLabel additions={0} deletions={0} binary />, {
    router: false,
  });
  await expect.element(screen.getByText("Binary")).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain("+0");
});

it("keeps the counts for a text file", async () => {
  await using screen = await render(<DiffStatLabel additions={4} deletions={0} />, {
    router: false,
  });
  await expect
    .element(screen.getByRole("group", { name: "4 additions, 0 deletions" }))
    .toBeInTheDocument();
  expect(screen.container.textContent).toContain("+4");
});
