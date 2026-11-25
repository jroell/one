import { useRef } from "react";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { useSlashFocusesSearch } from "./ListPageChrome";

function Page() {
  const ref = useRef<HTMLDivElement | null>(null);
  useSlashFocusesSearch(ref);
  return (
    <div ref={ref}>
      <input role="searchbox" aria-label="Search" defaultValue="open" />
      <input aria-label="Other field" />
      <button type="button">Sort</button>
    </div>
  );
}

describe("list page search shortcut", () => {
  it("does not focus the search field on arrival", async () => {
    await using screen = await render(<Page />, { router: false });
    expect(document.activeElement).toBe(document.body);
    await expect.element(screen.getByRole("searchbox", { name: "Search" })).toBeVisible();
  });

  it("focuses the search field and selects its text when / is pressed on the page", async () => {
    await using screen = await render(<Page />, { router: false });
    await userEvent.click(screen.getByRole("button", { name: "Sort" }));
    await userEvent.keyboard("/");
    const field = screen.getByRole("searchbox", { name: "Search" }).element() as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    // The slash itself is not typed into the field.
    expect(field.value).toBe("open");
  });

  it("types a literal / into another text field instead of jumping to the search field", async () => {
    await using screen = await render(<Page />, { router: false });
    const other = screen.getByRole("textbox", { name: "Other field" });
    await userEvent.click(other);
    await userEvent.keyboard("a/b");
    expect((other.element() as HTMLInputElement).value).toBe("a/b");
  });
});
