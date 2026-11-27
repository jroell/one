import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

function Cards({ firstHasRow }: { readonly firstHasRow: boolean }) {
  const [laterRow, setLaterRow] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setLaterRow(true)}>
        Fill
      </button>
      <ThreadDetailsSection headingId="first-heading" title="First" showHeading={false}>
        <div>{firstHasRow ? <span>Row</span> : null}</div>
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="second-heading" title="Second" showHeading={false}>
        <div>{laterRow ? <span>Row</span> : <span>Always</span>}</div>
      </ThreadDetailsSection>
    </div>
  );
}

const second = () => document.querySelector<HTMLElement>('section[aria-label="Second"]')!;
const first = () => document.querySelector<HTMLElement>('section[aria-label="First"]')!;

describe("details sections", () => {
  it("draws a divider above a section only when an earlier section has content", async () => {
    await using withRow = await render(<Cards firstHasRow />, { router: false });
    expect(getComputedStyle(second()).borderTopWidth).toBe("1px");
    await withRow.rerender(<Cards firstHasRow={false} />);
    await expect.poll(() => getComputedStyle(second()).borderTopWidth).toBe("0px");
    expect(getComputedStyle(first()).display).toBe("none");
  });

  it("follows a section that gains content after it was empty", async () => {
    await using screen = await render(<Cards firstHasRow={false} />, { router: false });
    expect(getComputedStyle(second()).borderTopWidth).toBe("0px");
    await screen.rerender(<Cards firstHasRow />);
    await expect.poll(() => getComputedStyle(second()).borderTopWidth).toBe("1px");
    await userEvent.click(page.getByRole("button", { name: "Fill" }));
    expect(getComputedStyle(second()).borderTopWidth).toBe("1px");
  });
});
