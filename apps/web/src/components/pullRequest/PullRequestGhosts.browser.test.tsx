import type { IssueListEntry } from "@t3tools/contracts";
import type { EnvironmentIssueEntry } from "@t3tools/client-runtime/issue-list";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { IssueRow } from "../issue/IssueRow";
import { PullRequestListGhost } from "./PullRequestGhosts";

import "~/index.css";

const entry = {
  environmentId: "env-1",
  projectId: "project-1",
  projectTitle: "repo",
  tracker: "github",
  host: "github.com",
  scope: "owner/repo",
  key: "7",
  displayKey: "#7",
  title: "A loaded issue row",
  url: "https://github.com/owner/repo/issues/7",
  author: { login: "octo", name: null, avatarUrl: null },
  state: { category: "open", name: "Open" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  closedAt: null,
  assignees: [],
  labels: [{ name: "bug", color: "d73a4a", description: null }],
  commentCount: 2,
} as unknown as EnvironmentIssueEntry & IssueListEntry;

describe("list skeleton", () => {
  it("renders the requested number of rows, each with the loaded row's four parts", async () => {
    await using screen = await render(<PullRequestListGhost rows={5} />, { router: false });
    const rows = screen.container.querySelectorAll("[data-one-ghost-row]");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const body = row.querySelector("[data-one-ghost-row-body]");
      // State glyph, then title line, then meta line, all inside one row body.
      expect(body?.querySelector(":scope > span:first-child")).not.toBeNull();
      expect(body?.querySelectorAll(":scope > span:nth-child(2) > span")).toHaveLength(2);
    }
  });

  it("is exactly as tall as a loaded row, so nothing shifts when the list arrives", async () => {
    await using screen = await render(
      <div style={{ width: 720 }}>
        <PullRequestListGhost rows={2} />
        <IssueRow
          entry={entry}
          selected={false}
          showScope={false}
          showTracker={false}
          onSelect={() => {}}
        />
      </div>,
      { router: false },
    );
    const ghost = screen.container.querySelector("[data-one-ghost-row]")!;
    const loaded = screen.container.querySelector("[data-one-row]:not([data-one-ghost-row])")!;
    expect(loaded).not.toBeNull();
    // 60px is the row height the page styles set; a different loaded height means they did not apply.
    expect(loaded.getBoundingClientRect().height).toBe(60);
    expect(ghost.getBoundingClientRect().height).toBe(60);
  });

  it("names what is loading once the caption is given", async () => {
    await using screen = await render(<PullRequestListGhost rows={1} caption="Loading issues…" />, {
      router: false,
    });
    expect(screen.container.querySelector("[role=status]")?.getAttribute("aria-label")).toBe(
      "Loading issues…",
    );
    expect(screen.container.querySelector("[data-one-ghost-caption]")?.textContent).toBe(
      "Loading issues…",
    );
  });

  it("says the load is slow and offers Retry after eight seconds, not before", async () => {
    using _timers = fakeTimers();
    const retries: number[] = [];
    await using screen = await render(
      <PullRequestListGhost
        rows={1}
        caption="Loading pull requests…"
        slowCaption="Still waiting for the host…"
        onRetry={() => retries.push(1)}
      />,
      { router: false },
    );
    const caption = () => screen.container.querySelector("[data-one-ghost-caption]")?.textContent;
    await act(() => vi.advanceTimersByTimeAsync(7_000));
    expect(caption()).toBe("Loading pull requests…");
    expect(screen.container.querySelector("button")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(caption()).toBe("Still waiting for the host…");
    screen.container.querySelector("button")!.click();
    expect(retries).toEqual([1]);
  });
});
