import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SharedThreadContext, ThreadCommandSubtitle } from "./ThreadCommandSubtitle";

const CONTEXT = "server · Local · custom/main";

function Subtitle() {
  return (
    <ThreadCommandSubtitle
      project={null}
      projectTitle="server"
      environmentLabel="Local"
      branch="custom/main"
      worktreePath={null}
      isCurrent={false}
      contextLabel={CONTEXT}
    />
  );
}

describe("ThreadCommandSubtitle", () => {
  it("shows the project and branch on its own row", async () => {
    await using _screen = await render(<Subtitle />, { router: false });

    await expect.element(page.getByText("server")).toBeVisible();
    await expect.element(page.getByText("custom/main")).toBeVisible();
  });

  it("leaves out the project and branch when its list already names them once", async () => {
    await using screen = await render(
      <SharedThreadContext value={CONTEXT}>
        <Subtitle />
      </SharedThreadContext>,
      { router: false },
    );

    expect(screen.container.textContent ?? "").not.toContain("server");
    expect(screen.container.textContent ?? "").not.toContain("custom/main");
  });

  it("keeps the project and branch when the list names a different place", async () => {
    await using _screen = await render(
      <SharedThreadContext value="other · Local · main">
        <Subtitle />
      </SharedThreadContext>,
      { router: false },
    );

    await expect.element(page.getByText("custom/main")).toBeVisible();
  });
});
