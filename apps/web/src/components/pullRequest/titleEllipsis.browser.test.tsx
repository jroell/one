import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { useWordEllipsis } from "./titleEllipsis";

import "~/index.css";

const TITLE = "fix(server): switching a thread between default and managed Codex no longer fails";

function Line({ width }: { width: number }) {
  const { ref, clipped } = useWordEllipsis(TITLE, true);
  return (
    <span style={{ display: "flex", width, gap: 6, fontSize: 14 }}>
      <span style={{ flex: "none", width: 40 }}>#1</span>
      <span ref={ref} data-title style={{ minWidth: 0, whiteSpace: "nowrap" }}>
        {clipped ? (
          <>
            {clipped.head}
            <span aria-hidden>{"…"}</span>
            <span className="sr-only">{clipped.rest}</span>
          </>
        ) : (
          TITLE
        )}
      </span>
      <span style={{ flex: "none", width: 60 }}>+1 -1</span>
    </span>
  );
}

describe("word-boundary title ellipsis", () => {
  it("ends a title that does not fit at a whole word and keeps the full text readable", async () => {
    await using screen = await render(<Line width={300} />, { router: false });
    const title = screen.container.querySelector("[data-title]")!;
    expect(title.textContent!.replace("\u2026", "")).toBe(TITLE);
    const visible = title.firstChild!.textContent!;
    expect(TITLE.startsWith(visible)).toBe(true);
    expect(TITLE[visible.length]).toBe(" ");
    expect(title.querySelector("[aria-hidden]")?.textContent).toBe("…");
  });

  it("shows the whole title again when the line grows wide enough", async () => {
    await using screen = await render(<Line width={300} />, { router: false });
    const clippedText = () =>
      screen.container.querySelector("[data-title]")!.firstChild!.textContent;
    expect(clippedText()).not.toBe(TITLE);
    await screen.rerender(<Line width={900} />);
    await expect.poll(clippedText).toBe(TITLE);
  });
});
