import "~/index.css";
import { FileTree } from "@pierre/trees";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DiffFileTree, type DiffFileTreeEntry } from "./DiffFileTree";
import { compareReviewFiles } from "./reviewFileOrder";

const FOLDERS = 300;

it("expands every folder without asking the tree about all folders for each one", async () => {
  // Two levels, so flattening empty folders cannot merge them into one.
  const entries: DiffFileTreeEntry[] = Array.from({ length: FOLDERS }, (_, index) => [
    { path: `package-${index}/a.ts`, status: "modified" as const },
    { path: `package-${index}/lib/b.ts`, status: "modified" as const },
  ]).flat();
  using getItem = vi.spyOn(FileTree.prototype, "getItem");
  await using _screen = await render(
    <div className="flex h-[600px] flex-col">
      <DiffFileTree entries={entries} onSelectFile={() => {}} ariaLabel="Changed files" />
    </div>,
  );
  const collapseAll = page.getByRole("button", { name: "Collapse all folders" });
  await expect.element(collapseAll).toBeVisible();
  await userEvent.click(collapseAll);
  const expandAll = page.getByRole("button", { name: "Expand all folders" });
  await expect.element(expandAll).toBeVisible();
  getItem.mockClear();
  await userEvent.click(expandAll);
  await expect.element(page.getByRole("button", { name: "Collapse all folders" })).toBeVisible();
  // Each of the expansions used to look up the folders again from the first one, so the lookups
  // grew with the square of the folder count (hundreds of thousands at 600 folders).
  expect(getItem.mock.calls.length).toBeLessThan(FOLDERS * 2 * 20);
});

// Chromium reports (pointer: fine) here; the tree reads the media query once when it is created.
function withCoarsePointer(): Disposable {
  const real = window.matchMedia.bind(window);
  const spy = vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query.includes("pointer: coarse")
      ? ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList)
      : real(query),
  );
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

it("reveals a changed file at the bottom of a long list on the 44px rows a touch screen gets", async () => {
  using _coarse = withCoarsePointer();
  const entries: DiffFileTreeEntry[] = Array.from({ length: 400 }, (_, index) => ({
    path: `file-${String(index).padStart(4, "0")}.ts`,
    status: "modified" as const,
  }));
  await using screen = await render(
    <div className="flex h-[400px] flex-col">
      <DiffFileTree
        entries={entries}
        onSelectFile={() => {}}
        selectedPath="file-0350.ts"
        revealRequestId={1}
        ariaLabel="Changed files"
      />
    </div>,
  );
  const row = page.getByRole("treeitem", { name: "file-0350.ts" });
  await expect.element(row).toBeVisible();
  const scroller = screen.container
    .querySelector("file-tree-container")!
    .shadowRoot!.querySelector("[data-file-tree-virtualized-scroll]")!;
  const rowRect = row.element().getBoundingClientRect();
  const hostRect = scroller.getBoundingClientRect();
  expect(Math.round(rowRect.height)).toBe(44);
  expect(rowRect.top).toBeGreaterThanOrEqual(hostRect.top);
  expect(rowRect.bottom).toBeLessThanOrEqual(hostRect.bottom);
});

it("lists files in the order the review list uses, keeping a folder's subtree together", async () => {
  const listed = [
    { path: "a/root.ts" },
    { path: "a-b/ext.ts" },
    { path: "a/sub/part.ts" },
    { path: "a/zeta.png", binary: true },
    { path: "z.ts" },
  ].toSorted(compareReviewFiles);
  const entries: DiffFileTreeEntry[] = listed.map((file) => ({
    path: file.path,
    status: "modified" as const,
  }));
  await using screen = await render(
    <div className="flex h-[600px] flex-col">
      <DiffFileTree entries={entries} onSelectFile={() => {}} ariaLabel="Changed files" />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "Collapse all folders" })).toBeVisible();
  const visiblePaths = () =>
    [...screen.container.querySelectorAll("file-tree-container")].flatMap((host) =>
      [...(host.shadowRoot?.querySelectorAll("[data-item-path]") ?? [])].map(
        (item) => item.getAttribute("data-item-path") ?? "",
      ),
    );
  await vi.waitFor(() => expect(visiblePaths().length).toBeGreaterThanOrEqual(listed.length));
  expect(visiblePaths().filter((path) => !path.endsWith("/"))).toEqual(
    listed.map((file) => file.path),
  );
});

it("names a focused row by its whole path, so the folder is read as well as the file", async () => {
  const entries: DiffFileTreeEntry[] = [
    { path: "apps/desktop/resources/dmg/dmg-background-latest.svg", status: "modified" as const },
    { path: "apps/desktop/resources/dmg/dmg-background-nightly.svg", status: "modified" as const },
  ];
  await using screen = await render(
    <div className="flex h-[400px] flex-col">
      <DiffFileTree entries={entries} onSelectFile={() => {}} ariaLabel="Changed files" />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "Collapse all folders" })).toBeVisible();
  const rowFor = (path: string) =>
    [...screen.container.querySelectorAll("file-tree-container")]
      .map((host) =>
        host.shadowRoot?.querySelector<HTMLElement>(`button[data-item-path="${path}"]`),
      )
      .find((row) => row);
  await vi.waitFor(() =>
    expect(rowFor("apps/desktop/resources/dmg/dmg-background-latest.svg")).toBeTruthy(),
  );
  const row = rowFor("apps/desktop/resources/dmg/dmg-background-latest.svg")!;
  row.focus();
  await vi.waitFor(() =>
    expect(row.getAttribute("aria-label")).toBe(
      "apps/desktop/resources/dmg/dmg-background-latest.svg",
    ),
  );
});

it("keeps the end of a long file name in a narrow tree, so siblings that differ at the end stay apart", async () => {
  const dir = "apps/desktop/resources/dmg";
  const entries: DiffFileTreeEntry[] = ["latest", "nightly"].map((kind) => ({
    path: `${dir}/dmg-background-${kind}.svg`,
    status: "modified" as const,
  }));
  await using screen = await render(
    <div className="flex h-[400px] w-[170px] flex-col">
      <DiffFileTree entries={entries} onSelectFile={() => {}} ariaLabel="Changed files" />
    </div>,
  );
  const tailOf = (kind: string) =>
    [...screen.container.querySelectorAll("file-tree-container")]
      .map((host) =>
        host.shadowRoot?.querySelector(
          `button[data-item-path="${dir}/dmg-background-${kind}.svg"]`,
        ),
      )
      .find((row) => row)
      ?.querySelectorAll("[data-truncate-segment-priority]")[1]
      ?.querySelector("[data-truncate-content='visible']")
      ?.textContent?.trim();
  await vi.waitFor(() => {
    expect(tailOf("latest")).toBe("latest.svg");
    expect(tailOf("nightly")).toBe("nightly.svg");
  });
});
