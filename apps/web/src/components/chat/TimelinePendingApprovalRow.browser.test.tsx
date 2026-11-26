import "~/index.css";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { clearApprovalDecision, noteApprovalDecision } from "~/one/approvalDecision";
import {
  ApprovalSubjectContext,
  deriveApprovalSubjects,
  type ApprovalSubject,
} from "~/one/chatApprovalSubject";
import { deriveTimelineEntriesFromVisibleTurnItems } from "~/session-logic";
import type { PendingApproval } from "../../session-logic";
import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { TimelineRowCtx } from "./timelineRowContext";

const requestId = RuntimeRequestId.make("request");
const patch = [
  "@@ -3,3 +3,4 @@",
  " keep",
  "-removed line",
  "+added line one",
  "+added line two",
].join("\n");

function approval(overrides: Partial<PendingApproval>): PendingApproval {
  return {
    requestId,
    requestKind: "file-change",
    createdAt: "2026-11-25T00:00:00Z",
    detail: "Changed files",
    responseCapability: "live",
    ...overrides,
  } as PendingApproval;
}

function row(pending: PendingApproval, subject: ApprovalSubject | null, onOpenToolDiff = vi.fn()) {
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff,
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: null })) },
  } as never;
  return (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext value={new Map(subject ? [[requestId, subject]] : [])}>
        <TimelinePendingApprovalRow approval={pending} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
}

const diffTarget = {
  threadId: ThreadId.make("thread"),
  itemId: TurnItemId.make("change"),
  revision: "r1",
};

it("shows the first hunk of the exact change being approved and opens its full diff", async () => {
  const onOpenToolDiff = vi.fn();
  await using screen = await render(
    row(
      approval({}),
      {
        path: "/repo/src/math.ts",
        moreFiles: 0,
        changes: [],
        additions: 2,
        deletions: 1,
        diffStr: patch,
        diffTarget,
      },
      onOpenToolDiff,
    ),
    { router: false },
  );
  await expect.element(screen.getByText("Needs approval")).toBeVisible();
  await expect.element(screen.getByText("added line one")).toBeVisible();
  await expect.element(screen.getByText("removed line")).toBeVisible();
  expect(screen.container.querySelectorAll("[data-approval-hunk-lines] > div")).toHaveLength(4);
  await screen.getByRole("button", { name: "Show full diff" }).click();
  expect(onOpenToolDiff).toHaveBeenCalledWith(diffTarget);
});

it("shows the approval's own details when its change has not arrived, never a guess", async () => {
  await using screen = await render(
    row(approval({ requestKind: "command", detail: "rm -rf build && vp build" }), null),
    { router: false },
  );
  await expect.element(screen.getByText("rm -rf build && vp build")).toBeVisible();
  expect(screen.container.querySelector("[data-approval-hunk]")).toBeNull();
  await expect
    .element(screen.getByRole("button", { name: "Show full diff" }))
    .not.toBeInTheDocument();
});

it("offers the full diff when the matched change has no preview to show", async () => {
  const onOpenToolDiff = vi.fn();
  await using screen = await render(
    row(
      approval({}),
      {
        path: "/repo/src/math.ts",
        moreFiles: 0,
        changes: [],
        additions: 2,
        deletions: 1,
        diffStr: null,
        diffTarget,
      },
      onOpenToolDiff,
    ),
    { router: false },
  );
  await expect.element(screen.getByText("src/math.ts")).toBeVisible();
  expect(screen.container.querySelector("[data-approval-hunk-lines]")).toBeNull();
  await screen.getByRole("button", { name: "Show full diff" }).click();
  expect(onOpenToolDiff).toHaveBeenCalledWith(diffTarget);
});

it("tells a screen reader which preview line is added, removed or unchanged, with its file line", async () => {
  await using screen = await render(
    row(approval({}), {
      path: "/repo/src/math.ts",
      moreFiles: 0,
      changes: [],
      additions: 2,
      deletions: 1,
      diffStr: patch,
      diffTarget,
    }),
    { router: false },
  );
  await expect.element(screen.getByText("added line one")).toBeVisible();
  const rows = [...screen.container.querySelectorAll("[data-approval-hunk-lines] > div")].map(
    (element) => element.textContent,
  );
  expect(rows).toEqual([
    expect.stringContaining("Unchanged line 3: keep"),
    expect.stringContaining("Removed line 4: removed line"),
    expect.stringContaining("Added line 4: added line one"),
    expect.stringContaining("Added line 5: added line two"),
  ]);
});

function pendingDetailRow(detail: ReturnType<typeof Atom.make>, onOpenToolDiff = vi.fn()) {
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff,
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => detail },
  } as never;
  return (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext
        value={
          new Map([
            [
              requestId,
              {
                path: "/repo/src/math.ts",
                moreFiles: 0,
                changes: [],
                additions: null,
                deletions: null,
                diffStr: null,
                diffTarget,
              },
            ],
          ])
        }
      >
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
}

it("keeps Approve, Decline and the full diff usable while the change is still loading", async () => {
  const onOpenToolDiff = vi.fn();
  await using screen = await render(
    pendingDetailRow(Atom.make(AsyncResult.initial(true)) as never, onOpenToolDiff),
    { router: false },
  );
  await expect.element(screen.getByText("Loading preview…")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  await screen.getByRole("button", { name: "Show full diff" }).click();
  expect(onOpenToolDiff).toHaveBeenCalledWith(diffTarget);
});

it("says the preview failed to load, offers Retry and still offers the full diff", async () => {
  await using screen = await render(
    pendingDetailRow(Atom.make(AsyncResult.fail(new Error("offline"))) as never),
    { router: false },
  );
  await expect.element(screen.getByText("Couldn't load the preview.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Show full diff" })).toBeVisible();
});

// The ACP sequence of the dev replay's showcase: a pending edit tool call carrying before and
// after text, then the permission request for the same call. The wire keeps no patch.
const SHOWCASE_OLD = "export function sum(a: number, b: number) {\n  return a + b;\n}\n";
const SHOWCASE_NEW = `${SHOWCASE_OLD}\nexport function clamp(value: number, min: number, max: number) {\n  return Math.min(Math.max(value, min), max);\n}\n`;

it("shows the added clamp lines for the replay's pending edit followed by its permission request", async () => {
  const threadId = ThreadId.make("replay-thread");
  const stamp = DateTime.makeUnsafe("2026-11-25T10:00:00Z");
  const base = (id: string, ordinal: number) => ({
    id: TurnItemId.make(id),
    threadId,
    runId: RunId.make("run"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: ProviderTurnId.make("turn"),
    nativeItemRef: {
      driver: ProviderDriverKind.make("acp"),
      nativeId: "showcase-edit",
      strength: "strong" as const,
    },
    parentItemId: null,
    ordinal,
    title: null,
    startedAt: stamp,
    completedAt: null,
    updatedAt: stamp,
    status: "waiting" as const,
  });
  const edit = {
    ...base("edit", 1),
    type: "file_change",
    fileName: "src/math.ts",
    changes: [{ operation: "update", path: "src/math.ts" }],
  } satisfies OrchestrationV2TurnItem;
  const permission = {
    ...base("permission", 2),
    type: "approval_request",
    requestId: requestId,
    requestKind: "file-change",
    prompt: "Edit src/math.ts",
  } satisfies OrchestrationV2TurnItem;
  const entries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [edit, permission].map((item) => ({
      position: item.ordinal,
      visibility: "local" as const,
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
    optimisticMessages: [],
  });
  const subject = deriveApprovalSubjects(entries, new Set([requestId])).get(requestId)!;
  expect(subject.diffStr).toBeNull();

  const full = { ...edit, oldStr: SHOWCASE_OLD, newStr: SHOWCASE_NEW };
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: full })) },
  } as never;
  await using screen = await render(
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext value={new Map([[requestId, subject]])}>
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>,
    { router: false },
  );
  await expect
    .element(screen.getByText("export function clamp(value: number, min: number, max: number) {"))
    .toBeVisible();
  const added = screen.container.querySelectorAll('[data-approval-hunk-lines] > [data-kind="add"]');
  expect(added.length).toBeGreaterThanOrEqual(3);
  // The recorded text proves no file offset, so no line is numbered from 1.
  const numbers = [...screen.container.querySelectorAll("[data-approval-hunk-number]")];
  expect(numbers.length).toBeGreaterThan(0);
  expect(numbers.every((number) => number.textContent === "")).toBe(true);
});

it("shows the new text when a waiting change is updated in place, asking for its new revision", async () => {
  const requested: string[] = [];
  const item = (text: string) =>
    ({ type: "file_change", diffStr: `@@ -1,1 +1,1 @@\n-old\n+${text}\n` }) as never;
  const source = (input: { readonly revision: string }) => {
    requested.push(input.revision);
    return Atom.make(
      AsyncResult.success({ item: item(input.revision === "r1" ? "first text" : "second text") }),
    ) as never;
  };
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: source },
  } as never;
  const view = (revision: string) => (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext
        value={
          new Map([
            [
              requestId,
              {
                path: "/repo/src/math.ts",
                moreFiles: 0,
                changes: [],
                additions: null,
                deletions: null,
                diffStr: null,
                diffTarget: { ...diffTarget, revision },
              },
            ],
          ])
        }
      >
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
  await using screen = await render(view("r1"), { router: false });
  await expect.element(screen.getByText("first text")).toBeVisible();
  await screen.rerender(view("r2"));
  await expect.element(screen.getByText("second text")).toBeVisible();
  expect(requested).toContain("r1");
  expect(requested).toContain("r2");
});

it("lays the card out as header, change and action bar on one 16px inset, with the path once", async () => {
  await using screen = await render(
    row(approval({}), {
      path: "/repo/src/math.ts",
      moreFiles: 0,
      changes: [],
      additions: 2,
      deletions: 1,
      diffStr: patch,
      diffTarget,
    }),
    { router: false },
  );
  await expect.element(screen.getByText("added line one")).toBeVisible();
  const card = screen.container.querySelector("[data-approval-card]") as HTMLElement;
  const rect = (selector: string) =>
    (card.querySelector(selector) as HTMLElement).getBoundingClientRect();
  const left = card.getBoundingClientRect().left;
  // One inset, 1rem: the header, the line numbers and the status chip all start on it.
  const inset = parseFloat(getComputedStyle(document.documentElement).fontSize);
  expect(rect("[data-approval-header] svg").left - left).toBeCloseTo(inset, 0);
  expect(rect("[data-approval-status]").left - left).toBeCloseTo(inset, 0);
  expect(
    parseFloat(
      getComputedStyle(card.querySelector("[data-approval-hunk-number]")!).paddingInlineStart,
    ),
  ).toBeCloseTo(inset, 0);
  const decline = screen.getByRole("button", { name: "Decline" }).element().getBoundingClientRect();
  const approveButton = screen.getByRole("button", { name: "Approve" }).element();
  const approve = approveButton.getBoundingClientRect();
  expect(approve.left - decline.right).toBeCloseTo(12, 0);
  expect(approve.height).toBeGreaterThanOrEqual(32);
  expect(decline.height).toBe(approve.height);
  // The change is one band: card and content are the only two levels, so it draws no border.
  expect(getComputedStyle(card.querySelector("[data-approval-content]")!).borderBottomWidth).toBe(
    "0px",
  );
  expect(card.textContent!.match(/math\.ts/g)).toHaveLength(1);
});

// Shaped like the file_change items the ACP projection emits: one change per file, with the
// operation the provider recorded and `oldPath` on a rename.
function filesSubject(
  changes: ReadonlyArray<{
    operation: string;
    path: string;
    oldPath?: string;
    fileType?: string;
    mimeType?: string;
  }>,
  overrides: Partial<ApprovalSubject> = {},
): ApprovalSubject {
  return {
    path: changes[0]?.path ?? "/repo/a.ts",
    moreFiles: Math.max(0, changes.length - 1),
    changes,
    additions: null,
    deletions: null,
    diffStr: null,
    diffTarget,
    ...overrides,
  };
}

async function renderFiles(subject: ApprovalSubject) {
  return render(row(approval({}), subject), { router: false });
}

it("names a rename in the header, with the old and the new path", async () => {
  await using screen = await renderFiles(
    filesSubject([{ operation: "rename", oldPath: "/repo/src/a.ts", path: "/repo/src/b.ts" }]),
  );
  const title = screen.container.querySelector("[data-approval-title]")!;
  expect(title.textContent).toMatch(/^Rename\s*src\/a\.ts\s*→\s*src\/b\.ts/);
});

it("names a delete and an add in the header with their path", async () => {
  await using screen = await renderFiles(
    filesSubject([{ operation: "delete", path: "/repo/src/gone.ts" }]),
  );
  expect(screen.container.querySelector("[data-approval-title]")!.textContent).toMatch(
    /^Delete\s*src\/gone\.ts/,
  );
  await using added = await renderFiles(
    filesSubject([{ operation: "add", path: "/repo/src/new.ts" }]),
  );
  expect(added.container.querySelector("[data-approval-title]")!.textContent).toMatch(
    /^Add\s*src\/new\.ts/,
  );
});

it("lists every file of a mixed approval with its operation, and names the approval by its size", async () => {
  await using screen = await renderFiles(
    filesSubject([
      { operation: "update", path: "/repo/src/edit.ts" },
      { operation: "rename", oldPath: "/repo/src/old.ts", path: "/repo/src/renamed.ts" },
      { operation: "delete", path: "/repo/src/removed.ts" },
    ]),
  );
  expect(screen.container.querySelector("[data-approval-title]")!.textContent).toContain(
    "Change 3 files",
  );
  const rows = [...screen.container.querySelectorAll("[data-approval-files] li")].map((item) =>
    item.textContent?.replace(/\s+/g, ""),
  );
  expect(rows).toEqual([
    "Editsrc/edit.ts",
    "Renamesrc/old.ts→src/renamed.ts",
    "Deletesrc/removed.ts",
  ]);
});

it("keeps showing the files, with the full diff, when the patch was omitted", async () => {
  await using screen = await renderFiles(
    filesSubject([
      { operation: "update", path: "/repo/big/one.ts" },
      { operation: "update", path: "/repo/big/two.ts" },
    ]),
  );
  expect(screen.container.querySelectorAll("[data-approval-files] li")).toHaveLength(2);
  expect(screen.container.querySelector("[data-approval-title]")!.textContent).toContain(
    "Edit 2 files",
  );
  await expect.element(screen.getByRole("button", { name: "Show full diff" })).toBeVisible();
});

it("folds files past five behind a count and shows them all on request", async () => {
  const changes = Array.from({ length: 8 }, (_, index) => ({
    operation: "update",
    path: `/repo/src/file-${index}.ts`,
  }));
  await using screen = await renderFiles(filesSubject(changes));
  expect(screen.container.querySelectorAll("[data-approval-files] li")).toHaveLength(5);
  await screen.getByRole("button", { name: "3 more files" }).click();
  expect(screen.container.querySelectorAll("[data-approval-files] li")).toHaveLength(8);
  await screen.getByRole("button", { name: "Show fewer files" }).click();
  expect(screen.container.querySelectorAll("[data-approval-files] li")).toHaveLength(5);
});

it("shows the file type a single file carries, which only the list can show", async () => {
  await using screen = await renderFiles(
    filesSubject([
      { operation: "add", path: "/repo/logo.png", fileType: "file", mimeType: "image/png" },
    ]),
  );
  expect(screen.container.querySelector("[data-approval-files]")!.textContent).toContain(
    "file, image/png",
  );
});

function cardWith(options: {
  responding?: boolean;
  pending?: ReadonlyMap<string, unknown>;
  onRespond?: () => Promise<unknown>;
}) {
  const shared = {
    respondingRequestIds: options.responding ? [requestId] : [],
    canOperateThread: true,
    onRespondToApproval: options.onRespond ?? (async () => {}),
    workspaceRoot: "/repo",
    onOpenToolDiff: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: null })) },
    pendingApprovals: options.pending ?? new Map([[requestId, approval({})]]),
  } as never;
  return (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext
        value={
          new Map([
            [
              requestId,
              {
                path: "/repo/src/math.ts",
                moreFiles: 0,
                changes: [],
                additions: null,
                deletions: null,
                diffStr: patch,
                diffTarget,
              },
            ],
          ])
        }
      >
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
}

it("shows the Approve and Decline chords on the card the chords act on, and no other", async () => {
  await using first = await render(cardWith({}), { router: false });
  const hints = [...first.container.querySelectorAll("[data-approval-hint]")].map(
    (hint) => hint.textContent,
  );
  expect(hints).toHaveLength(2);
  expect(hints.every((hint) => (hint ?? "").length > 0)).toBe(true);
  const other = RuntimeRequestId.make("older");
  await using later = await render(
    cardWith({ pending: new Map([[other, approval({ requestId: other })]]) }),
    { router: false },
  );
  expect(later.container.querySelectorAll("[data-approval-hint]")).toHaveLength(0);
});

it("answers a press with Approving… at full strength while the other actions dim", async () => {
  await using screen = await render(cardWith({ onRespond: () => new Promise(() => {}) }), {
    router: false,
  });
  await screen.getByRole("button", { name: "Approve" }).click();
  await screen.rerender(cardWith({ responding: true, onRespond: () => new Promise(() => {}) }));
  const approve = screen.getByRole("button", { name: "Approving…" });
  await expect.element(approve).toBeVisible();
  expect(approve.element().hasAttribute("data-pending")).toBe(true);
  await vi.waitFor(() => {
    expect(getComputedStyle(approve.element()).opacity).toBe("1");
    const decline = screen.getByRole("button", { name: "Decline" }).element();
    expect(Number(getComputedStyle(decline).opacity)).toBeLessThan(1);
  });
  // The change stays in view until the answer arrives: nothing folds on the press.
  const body = screen.container.querySelector("[data-approval-body-inner]") as HTMLElement;
  expect(body.getBoundingClientRect().height).toBeGreaterThan(0);
});

it("enters over the surface duration with no rail on its edge", async () => {
  await using screen = await render(cardWith({}), { router: false });
  const card = screen.container.querySelector("[data-approval-card]") as HTMLElement;
  expect(getComputedStyle(card).animationName).toBe("one-approval-in");
  expect(getComputedStyle(card, "::after").content).toBe("none");
  const footerButton = card.querySelector("[data-approval-footer] > *") as HTMLElement;
  expect(getComputedStyle(footerButton).animationDelay).toBe("0.08s");
});

function leavingCard(decision: "accept" | "decline" | null, onApprovalLeft: (id: unknown) => void) {
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: null })) },
    pendingApprovals: new Map([[requestId, approval({})]]),
    leavingApprovals: new Map([[requestId, decision]]),
    onApprovalLeft,
  } as never;
  return (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext
        value={
          new Map([
            [
              requestId,
              {
                path: "/repo/src/math.ts",
                moreFiles: 0,
                changes: [],
                additions: null,
                deletions: null,
                diffStr: patch,
                diffTarget,
              },
            ],
          ])
        }
      >
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
}

it("names Approve with a gold check and Decline without one while the card leaves, then tells the timeline it is done", async () => {
  const left = vi.fn();
  await using approved = await render(leavingCard("accept", left), { router: false });
  const card = approved.container.querySelector("[data-approval-card]") as HTMLElement;
  expect(card.getAttribute("data-leaving")).toBe("");
  expect(card.querySelector("[data-approval-outcome]")!.textContent).toBe("Approved");
  expect(card.getAttribute("data-outcome")).toBe("approved");
  const gold = (element: Element) => getComputedStyle(element).color;
  const approvedCheck = card.querySelector("[data-approval-outcome] svg")!;
  await vi.waitFor(() => expect(left).toHaveBeenCalledWith(requestId));
  expect(left).toHaveBeenCalledTimes(1);
  await using declined = await render(leavingCard("decline", vi.fn()), { router: false });
  const declinedCard = declined.container.querySelector("[data-approval-card]") as HTMLElement;
  expect(declinedCard.querySelector("[data-approval-outcome]")!.textContent).toBe("Declined");
  expect(declinedCard.getAttribute("data-outcome")).toBe("declined");
  expect(gold(declinedCard.querySelector("[data-approval-outcome] svg")!)).not.toBe(
    gold(approvedCheck),
  );
});

it("shows Approving… when the answer came from a key chord, not the button", async () => {
  noteApprovalDecision(requestId, "accept");
  try {
    await using screen = await render(cardWith({ responding: true }), { router: false });
    const approve = screen.getByRole("button", { name: "Approving…" });
    await expect.element(approve).toBeVisible();
    expect(approve.element().hasAttribute("data-pending")).toBe(true);
  } finally {
    clearApprovalDecision(requestId);
  }
});

it("keeps the pressed button reading Approving… at full strength while the card leaves", async () => {
  noteApprovalDecision(requestId, "accept");
  try {
    await using screen = await render(leavingCard("accept", vi.fn()), { router: false });
    const approve = screen.getByRole("button", { name: "Approving…" });
    await expect.element(approve).toBeVisible();
    expect(approve.element().hasAttribute("data-pending")).toBe(true);
    expect(screen.getByRole("button", { name: "Decline" }).element().hasAttribute("disabled")).toBe(
      true,
    );
  } finally {
    clearApprovalDecision(requestId);
  }
});
