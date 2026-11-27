import { startTransition, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { SidebarRowsOutline } from "./SidebarRowsOutline";
import {
  forgetSidebarRows,
  recalledSidebarRows,
  rememberSidebarRows,
  showSidebarOutline,
} from "./sidebarRowsMemory";
import { useProgressiveCount } from "./useProgressiveCount";

describe("the sidebar outline", () => {
  it("draws last visit's rows at the heights of the real ones: 52px for a card, 36px for a one-line row", async () => {
    forgetSidebarRows();
    rememberSidebarRows(["card", "card", "slim", "slim", "slim"]);
    await using screen = await render(<SidebarRowsOutline />, { router: false });

    const rows = [...screen.container.querySelectorAll("[data-sidebar-rows-outline] > li")];
    expect(rows.map((row) => Math.round(row.getBoundingClientRect().height))).toEqual([
      52, 52, 36, 36, 36,
    ]);
    forgetSidebarRows();
  });

  it("keeps the shape for the next session, and a first visit draws six one-line rows", () => {
    forgetSidebarRows();
    expect(recalledSidebarRows()).toEqual(Array.from({ length: 6 }, () => "slim"));

    rememberSidebarRows(["card", "slim", "slim"]);

    expect(localStorage.getItem("one:sidebar:rows")).toBe("css");
    forgetSidebarRows();
  });

  it("shows only while the list has not arrived: not for a search, not once the shells are in, not with rows", () => {
    const base = { searching: false, shellsBootstrapped: false, listedRows: 0 };
    expect(showSidebarOutline(base)).toBe(true);
    expect(showSidebarOutline({ ...base, searching: true })).toBe(false);
    expect(showSidebarOutline({ ...base, shellsBootstrapped: true })).toBe(false);
    expect(showSidebarOutline({ ...base, listedRows: 3 })).toBe(false);
  });
});

const drawn: number[] = [];

function Counter({ total }: { readonly total: number }) {
  const count = useProgressiveCount(total, 40, 60);
  drawn.push(count);
  return <span data-testid="count">{Number.isFinite(count) ? count : "all"}</span>;
}

function Growing() {
  const [total, setTotal] = useState(300);
  return (
    <>
      <button type="button" onClick={() => startTransition(() => setTotal(310))}>
        grow
      </button>
      <Counter total={total} />
    </>
  );
}

describe("drawing a long list in slices", () => {
  it("draws the first 40 of 300 at once and then all of them in later frames", async () => {
    drawn.length = 0;
    await using screen = await render(<Counter total={300} />, { router: false });

    await expect.element(page.getByTestId("count")).toHaveTextContent("all");
    expect(screen.container.isConnected).toBe(true);

    expect(drawn[0], "the first render drew 40").toBe(40);
    expect(drawn.filter((count) => count === 300)).toEqual([]);
    expect(drawn.at(-1)).toBe(Number.POSITIVE_INFINITY);
  });

  it("draws a short list whole at once", async () => {
    await using screen = await render(<Counter total={12} />, { router: false });
    expect(screen.container.querySelector("[data-testid=count]")?.textContent).toBe("all");
  });

  it("keeps drawing everything when the list grows after it was all drawn", async () => {
    await using screen = await render(<Growing />, { router: false });
    await expect.element(page.getByTestId("count")).toHaveTextContent("all");

    await page.getByRole("button", { name: "grow" }).click();
    await vi.waitFor(() =>
      expect(screen.container.querySelector("[data-testid=count]")?.textContent).toBe("all"),
    );
  });
});
