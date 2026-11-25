import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { SharedThreadContext, ThreadCommandSubtitle } from "./ThreadCommandSubtitle";

const KEY = "env-1\u0000project-1\u0000custom/main\u0000";

function Subtitle() {
  return (
    <ThreadCommandSubtitle
      project={null}
      projectTitle="server"
      environmentLabel="Local"
      branch="custom/main"
      worktreePath={null}
      isCurrent={false}
      contextKey={KEY}
    />
  );
}

describe("ThreadCommandSubtitle", () => {
  it("shows the project and branch on its own row", async () => {
    await using _screen = await render(<Subtitle />, { router: false });

    await expect.element(page.getByText("server")).toBeVisible();
    await expect.element(page.getByText("custom/main")).toBeVisible();
  });

  it("hides the project and branch from the eye when its list names them once, but keeps them for assistive tech", async () => {
    await using screen = await render(
      <SharedThreadContext value={KEY}>
        <Subtitle />
      </SharedThreadContext>,
      { router: false },
    );

    const hidden = screen.container.querySelector<HTMLElement>(".sr-only")!;
    expect(hidden.textContent).toBe("server, Local, custom/main");
    const box = hidden.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
  });

  it("keeps the project and branch when the list names a different place", async () => {
    await using _screen = await render(
      <SharedThreadContext value="env-1\u0000project-1\u0000other\u0000">
        <Subtitle />
      </SharedThreadContext>,
      { router: false },
    );

    await expect.element(page.getByText("custom/main")).toBeVisible();
  });
});
