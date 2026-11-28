import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  CheckpointRef,
  CheckpointScopeId,
  ProjectId,
  RunId,
  ThreadId,
  TurnItemId,
  type ClientSettings,
  type OrchestrationGetTurnDiffResult,
  type ReviewBranchCommitsResult,
  type ReviewDiffPreviewResult,
  type ReviewDiffPreviewSource,
  type ScopedThreadRef,
  type VcsListRefsResult,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { makeThreadFixture } from "~/test-fixtures";

type ResultAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, Error>>;

const state = vi.hoisted(() => ({
  thread: null as ReturnType<typeof makeThreadFixture> | null,
  threadRef: null as ScopedThreadRef | null,
  previews: new Map<string | null, ResultAtom<ReviewDiffPreviewResult>>(),
  patch: null as unknown as ResultAtom<ReviewDiffPreviewSource>,
  diffFilesCollapsed: false,
  project: {
    workspaceRoot: "/project",
    repositoryIdentity: null as { rootPath: string } | null,
  },
  toolCallItem: null as unknown,
  config: null as unknown as Atom.Atom<null>,
  status: null as unknown as ResultAtom<VcsStatusResult>,
  localRefs: null as unknown as ResultAtom<VcsListRefsResult>,
  remoteRefs: null as unknown as ResultAtom<VcsListRefsResult>,
  commits: null as unknown as ResultAtom<ReviewBranchCommitsResult>,
  checkpoints: [] as unknown[],
  checkpointDiff: null as Partial<OrchestrationGetTurnDiffResult> | null,
}));

vi.mock("~/state/server", () => ({
  serverEnvironment: { configValueAtom: () => state.config },
}));
vi.mock("~/state/review", () => ({
  reviewEnvironment: {
    diffPreview: ({ input }: { input: { baseRef?: string } }) =>
      state.previews.get(input.baseRef ?? null)!,
    branchCommits: () => state.commits,
    diffFilePatch: () => state.patch,
    diffFileContents: {},
  },
}));
vi.mock("~/state/vcs", () => ({
  vcsEnvironment: {
    status: () => state.status,
    listRefs: ({ input }: { input: { refKind: "local" | "remote" } }) =>
      input.refKind === "local" ? state.localRefs : state.remoteRefs,
  },
}));
vi.mock("~/state/entities", () => ({
  useQuietThreadShell: () => state.thread,
  useProject: () => state.project,
  useThreadCheckpointSummaries: () => state.checkpoints,
  useQuietThreadVisibleTurnItems: () => [],
  useQuietThreadProjection: () => null,
}));
vi.mock("~/state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
  filesystemEnvironment: {},
}));
vi.mock("~/hooks/useThreadRouteTarget", () => ({ useThreadRouteRef: () => state.threadRef }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: ClientSettings) => unknown) =>
    select({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: state.diffFilesCollapsed }),
  updateClientSettings: async () => {},
}));
vi.mock("~/hooks/useTheme", () => ({
  useRenderedAppearance: () => "dark",
  getRenderedAppearance: () => "dark",
  subscribeRenderedAppearance: () => () => {},
}));
vi.mock("~/state/queries", () => ({
  useCheckpointDiff: () => ({ data: state.checkpointDiff, error: null, isPending: false }),
  useTurnItemDetail: () => ({
    data: state.toolCallItem ? { item: state.toolCallItem } : null,
    error: null,
    isPending: false,
  }),
  useDebouncedValue: <A,>(value: A) => value,
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => async () => {} }));
vi.mock("~/editorPreferences", () => ({ useOpenInPreferredEditor: () => async () => {} }));
vi.mock("~/fileContextMenu", () => ({ useFileContextMenuHandler: () => () => {} }));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => async () => {} }));
vi.mock("./diffs/DiffCommentAnnotation", () => ({ DiffCommentAnnotation: () => null }));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: () => ({
    _tag: "Success",
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
    expiresAt: Number.MAX_SAFE_INTEGER,
  }),
}));
vi.mock("./diffs/DiffFileTree", () => ({ DiffFileTree: () => null }));
vi.mock("./DiffFilePathCopyButton", () => ({ DiffFilePathCopyButton: () => null }));

import DiffPanel from "./DiffPanel";
import { useDiffPanelSessionStore, useDiffPanelStore } from "~/diffPanelStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

const cwd = "/project-worktree";
const errorMessage = "Could not find a common commit between 'origin/orphan' and HEAD.";

function preview(): ReviewDiffPreviewResult {
  return {
    cwd,
    generatedAt: DateTime.makeUnsafe("2026-10-30T00:00:00Z"),
    sources: [
      {
        id: "branch",
        kind: "branch-range",
        title: "Changes",
        baseRef: "main",
        headRef: "dev",
        diff: "",
        diffHash: "empty",
        truncated: false,
        patchesDeferred: true,
        files: [],
      },
    ],
  };
}

function setup(failedBaseRef: string | null) {
  const reset = () => {
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    });
    useDiffPanelSessionStore.setState({ collapsedFileKeysByScopeKey: {} });
    useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  };
  reset();
  state.diffFilesCollapsed = false;
  state.project = { workspaceRoot: "/project", repositoryIdentity: null };
  state.toolCallItem = null;
  state.checkpoints = [];
  state.checkpointDiff = null;
  const patch = Atom.make<AsyncResult.AsyncResult<ReviewDiffPreviewSource, Error>>(
    AsyncResult.initial(),
  );
  state.patch = patch;
  state.threadRef = {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
  };
  state.thread = makeThreadFixture({
    ...state.threadRef,
    id: state.threadRef.threadId,
    projectId: ProjectId.make("project"),
    branch: "dev",
    worktreePath: cwd,
  });
  state.previews.clear();
  state.previews.set(null, Atom.make(AsyncResult.success(preview())));
  state.previews.set("main", Atom.make(AsyncResult.success(preview())));
  state.previews.set(failedBaseRef, Atom.make(AsyncResult.fail(new Error(errorMessage))));
  state.config = Atom.make(null);
  state.status = Atom.make(
    AsyncResult.success({
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "dev",
      hasWorkingTreeChanges: false,
      workingTree: { rootPath: cwd, files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    }),
  );
  const refs = (names: string[], isRemote: boolean): VcsListRefsResult => ({
    isRepo: true,
    hasPrimaryRemote: true,
    nextCursor: null,
    totalCount: names.length,
    refs: names.map((name) => ({
      name,
      isRemote,
      ...(isRemote ? { remoteName: "origin" } : {}),
      current: name === "dev",
      isDefault: name === "main",
      worktreePath: null,
    })),
  });
  state.localRefs = Atom.make(AsyncResult.success(refs(["dev", "main"], false)));
  state.remoteRefs = Atom.make(AsyncResult.success(refs(["origin/orphan"], true)));
  state.commits = Atom.make(AsyncResult.success({ commits: [], truncated: false }));
  useDiffPanelStore.getState().selectBranchBaseRef(state.threadRef, failedBaseRef);
  const registry = AtomRegistry.make();
  return {
    registry,
    patch,
    threadRef: state.threadRef,
    [Symbol.dispose]() {
      registry.dispose();
      reset();
    },
  };
}

it.each([
  {
    name: "a saved unrelated branch",
    failedBaseRef: "origin/orphan",
    recovery: "Automatic",
    baseRef: null,
  },
  {
    name: "an automatic base with unrelated history",
    failedBaseRef: null,
    recovery: "main",
    baseRef: "main",
  },
])(
  "recovers from $name without leaving the diff panel",
  async ({ failedBaseRef, recovery, baseRef }) => {
    using context = setup(failedBaseRef);
    await using screen = await render(
      <RegistryContext.Provider value={context.registry}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText(errorMessage, { exact: true })).toBeVisible();
    const selector = screen.getByRole("combobox", { name: /Change comparison target/ });
    await vi.waitFor(() => expect(selector.query()).not.toBeNull());
    await userEvent.click(selector);
    await expect.element(page.getByRole("option", { name: "main", exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("option", { name: recovery, exact: true }));
    await expect.element(screen.getByText("No net changes in this selection.")).toBeVisible();
    await expect.element(screen.getByText(errorMessage, { exact: true })).not.toBeInTheDocument();
    const key = scopedThreadKey(context.threadRef);
    await vi.waitFor(() => {
      expect(useDiffPanelStore.getState().byThreadKey[key]).toEqual({ kind: "branch", baseRef });
      expect(useDiffPanelStore.getState().branchBaseRefByThreadKey[key]).toBe(baseRef);
    });
  },
);

it("opens a repository-relative file from a nested project without a remote", async () => {
  using context = setup("origin/orphan");
  state.thread = { ...state.thread!, worktreePath: null };
  const path = "project/back\\slash.txt";
  const metadata = preview();
  const source = {
    ...metadata.sources[0]!,
    files: [{ path, previousPath: null, additions: 1, deletions: 0 }],
  };
  state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
  state.status = Atom.make(
    AsyncResult.success({
      ...AsyncResult.getOrElse(context.registry.get(state.status), () => {
        throw new Error("Missing status");
      }),
      workingTree: { rootPath: "/", files: [], insertions: 0, deletions: 0 },
    }),
  );
  useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
    </RegistryContext.Provider>,
  );
  await userEvent.click(screen.getByText(path, { exact: true }));
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, context.threadRef),
  ).toMatchObject({ activeSurfaceId: "file:back\\slash.txt" });
});

it("explains a branch diff whose only changes are hidden test files", async () => {
  using context = setup("origin/orphan");
  using _hideTestFiles = {
    [Symbol.dispose]() {
      window.localStorage.removeItem("t3code.diffHideTestFiles");
    },
  };
  const path = "math.test.ts";
  const metadata = preview();
  const source = {
    ...metadata.sources[0]!,
    files: [{ path, previousPath: null, additions: 1, deletions: 0 }],
  };
  state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
  useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  await expect.element(screen.getByText(path, { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "View options" }));
  await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Hide test files" }));
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByText(path, { exact: true })).not.toBeInTheDocument();
  await expect.element(screen.getByText("1 test file hidden", { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Show test files", exact: true }));
  await expect.element(screen.getByText(path, { exact: true })).toBeVisible();
});

it("the diff header counts only the files left shown after Hide test files", async () => {
  using context = setup("origin/orphan");
  using _hideTestFiles = {
    [Symbol.dispose]() {
      window.localStorage.removeItem("t3code.diffHideTestFiles");
    },
  };
  const metadata = preview();
  const source = {
    ...metadata.sources[0]!,
    files: [
      { path: "math.ts", previousPath: null, additions: 1, deletions: 0 },
      { path: "math.test.ts", previousPath: null, additions: 1, deletions: 0 },
    ],
  };
  state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
  useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  const summary = () => document.querySelector("[data-one-diff-summary]")?.textContent;
  await expect.poll(summary).toBe("2 files");
  await userEvent.click(screen.getByRole("button", { name: "View options" }));
  await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Hide test files" }));
  await userEvent.keyboard("{Escape}");
  await expect.poll(summary).toBe("1 file");
});

it.each([false, true])(
  "expands an unloaded file on the first click with default collapse %s",
  async (collapsed) => {
    using context = setup("origin/orphan");
    state.diffFilesCollapsed = collapsed;
    const path = `pending-${collapsed}.txt`;
    const metadata = preview();
    const source = {
      ...metadata.sources[0]!,
      files: [{ path, previousPath: null, additions: 1, deletions: 1 }],
    };
    state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
    useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
    await using screen = await render(
      <RegistryContext.Provider value={context.registry}>
        <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
          <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
        </div>
      </RegistryContext.Provider>,
    );
    const toggle = screen.getByRole("button", { name: `Expand ${path}`, exact: true });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await act(() =>
      context.registry.set(
        context.patch,
        AsyncResult.success({
          ...source,
          diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`,
        }),
      ),
    );
    const loadedToggle = screen.getByRole("button", { name: `Collapse ${path}`, exact: true });
    await expect.element(loadedToggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByText("after", { exact: true })).toBeVisible();
    await userEvent.click(loadedToggle);
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  },
);

async function renderLazyFile(stat: { path: string; binary?: boolean }) {
  const context = setup("origin/orphan");
  const metadata = preview();
  const source = {
    ...metadata.sources[0]!,
    files: [{ previousPath: null, additions: 0, deletions: 0, ...stat }],
  };
  state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
  useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
  const screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  return { context, screen, source };
}

it("labels a deferred file Binary from the server's flag before its patch loads", async () => {
  const { context, screen } = await renderLazyFile({ path: "flagged-firmware", binary: true });
  using _context = context;
  await using _screen = screen;
  await expect.element(screen.getByText("Binary", { exact: true })).toBeVisible();
});

it("labels a deferred file Binary from its loaded patch when an older server sends no flag", async () => {
  const { context, screen, source } = await renderLazyFile({ path: "unflagged-firmware" });
  using _context = context;
  await using _screen = screen;
  await userEvent.click(
    screen.getByRole("button", { name: "Expand unflagged-firmware", exact: true }),
  );
  await act(() =>
    context.registry.set(
      context.patch,
      AsyncResult.success({
        ...source,
        diff: "diff --git a/unflagged-firmware b/unflagged-firmware\nindex 1..2 100755\nBinary files a/unflagged-firmware and b/unflagged-firmware differ\n",
      }),
    ),
  );
  await expect
    .element(screen.getByRole("button", { name: "Collapse unflagged-firmware", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("Binary", { exact: true })).toBeVisible();
});

it("does not label a deferred file Binary when the server says it is not", async () => {
  const { context, screen } = await renderLazyFile({ path: "unflagged-notes.db", binary: false });
  using _context = context;
  await using _screen = screen;
  await expect
    .element(screen.getByText("unflagged-notes.db", { exact: true }).first())
    .toBeVisible();
  await expect.element(screen.getByText("Binary", { exact: true })).not.toBeInTheDocument();
});

it("previews a changed image when its file row is expanded", async () => {
  using context = setup("origin/orphan");
  const path = "changed.png";
  const metadata = preview();
  const source = {
    ...metadata.sources[0]!,
    files: [{ path, previousPath: null, additions: 0, deletions: 0 }],
  };
  state.previews.set("main", Atom.make(AsyncResult.success({ ...metadata, sources: [source] })));
  useDiffPanelStore.getState().selectBranchBaseRef(context.threadRef, "main");
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: `Expand ${path}`, exact: true }));
  await act(() =>
    context.registry.set(
      context.patch,
      AsyncResult.success({
        ...source,
        diff: `diff --git a/${path} b/${path}\nindex 19fc4a5..fd0af9e 100644\nBinary files a/${path} and b/${path} differ\n`,
      }),
    ),
  );
  await expect
    .element(screen.getByRole("button", { name: `Collapse ${path}`, exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByRole("img", { name: path })).toBeVisible();
});

it("says a turn diff cut off at the server's size limit is incomplete", async () => {
  using context = setup("origin/orphan");
  state.checkpoints = [
    {
      runId: "run",
      checkpointTurnCount: 1,
      checkpointRef: "ref",
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-01-01T00:00:00Z",
    },
  ];
  state.checkpointDiff = {
    diff: "diff --git a/first.txt b/first.txt\n--- a/first.txt\n+++ b/first.txt\n@@ -0,0 +1 @@\n+visible\n\n[truncated]",
  };
  useDiffPanelStore.getState().selectTurn(context.threadRef, RunId.make("run"));
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  await expect.element(screen.getByText("first.txt", { exact: true }).first()).toBeVisible();
  await expect
    .element(screen.getByText("This preview exceeds the size limit. Changes shown are incomplete."))
    .toBeVisible();
});

async function renderTurnPatch(patchLines: string[], width = 900) {
  const context = setup("origin/orphan");
  state.checkpoints = [
    {
      runId: "run",
      checkpointTurnCount: 1,
      checkpointRef: "ref",
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-01-01T00:00:00Z",
    },
  ];
  state.checkpointDiff = { diff: patchLines.join("\n") };
  useDiffPanelStore.getState().selectTurn(context.threadRef, RunId.make("run"));
  const screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, width, display: "flex", flexDirection: "column" }}>
        <DiffPanel
          mode="embedded"
          composerDraftTarget={context.threadRef}
          workspaceMutationId={null}
          visible
        />
      </div>
    </RegistryContext.Provider>,
  );
  return { context, screen };
}

it("labels an extensionless file Binary because the patch marks it binary", async () => {
  const { context, screen } = await renderTurnPatch([
    "diff --git a/firmware b/firmware",
    "index 1..2 100755",
    "Binary files a/firmware and b/firmware differ",
    "",
  ]);
  using _context = context;
  await using _screen = screen;
  await expect.element(screen.getByText("firmware", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByText("Binary", { exact: true })).toBeVisible();
});

it("names the collapse button in text on a wide panel and only by icon on a narrow one", async () => {
  const patch = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ];
  const wide = await renderTurnPatch(patch, 900);
  {
    using _context = wide.context;
    await using _screen = wide.screen;
    await expect.element(wide.screen.getByText(/^(Collapse|Expand) all files$/)).toBeVisible();
    expect(wide.screen.container.querySelectorAll("[data-one-toolbar-sep]").length).toBeGreaterThan(
      0,
    );
  }
  const narrow = await renderTurnPatch(patch, 420);
  using _context = narrow.context;
  await using _screen = narrow.screen;
  await expect
    .element(narrow.screen.getByRole("button", { name: /^(Collapse|Expand) all files$/ }))
    .toBeVisible();
  await expect.element(narrow.screen.getByText(/^(Collapse|Expand) all files$/)).not.toBeVisible();
});

it("keeps wrap, whitespace and the file tree in one View menu as checkable items", async () => {
  const wide = await renderTurnPatch(
    ["diff --git a/a.txt b/a.txt", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-a", "+b", ""],
    900,
  );
  using _context = wide.context;
  await using _screen = wide.screen;
  await expect.element(wide.screen.getByText(/^1 file$/)).toBeVisible();
  await wide.screen.getByRole("button", { name: "View options" }).click();
  const whitespace = page.getByRole("menuitemcheckbox", { name: "Hide whitespace changes" });
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Wrap lines" })).toBeVisible();
  const iconWidths = new Set<number>();
  // Each item is one row: the icon and its label share a line, and the row is 32px or taller.
  for (const name of ["Wrap lines", "Hide whitespace changes", "Show file tree"]) {
    const item = page.getByRole("menuitemcheckbox", { name }).element() as HTMLElement;
    const label = [...item.querySelectorAll("span")].find((span) => span.textContent === name)!;
    const icon = label.querySelector("svg")!;
    const centre = (box: DOMRect) => box.top + box.height / 2;
    expect(
      Math.abs(centre(icon.getBoundingClientRect()) - centre(label.getBoundingClientRect())),
    ).toBeLessThan(2);
    iconWidths.add(Math.round(icon.getBoundingClientRect().width));
    expect(icon.getBoundingClientRect().width).toBeGreaterThanOrEqual(15);
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
  }
  expect(iconWidths.size).toBe(1);
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Show file tree" }))
    .toBeVisible();
  const before = whitespace.element().getAttribute("aria-checked");
  await whitespace.click();
  await wide.screen.getByRole("button", { name: "View options" }).click();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Hide whitespace changes" }))
    .toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});

it("does not label a mode-only change to notes.db Binary", async () => {
  const { context, screen } = await renderTurnPatch([
    "diff --git a/notes.db b/notes.db",
    "old mode 100644",
    "new mode 100755",
    "",
  ]);
  using _context = context;
  await using _screen = screen;
  await expect.element(screen.getByText("notes.db", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByText("Binary", { exact: true })).not.toBeInTheDocument();
});

it("shows a turn's repositories in a folder that is not a Git repository", async () => {
  using context = setup("origin/orphan");
  state.status = Atom.make(
    AsyncResult.success({
      isRepo: false,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    }),
  );
  const patch = (path: string) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`;
  const repository = (name: string) => ({
    scopeId: CheckpointScopeId.make(`scope-${name}`),
    name,
    repositoryPath: `${cwd}/${name}`,
    cwd: `${cwd}/${name}`,
    relativePath: name,
    files: [{ path: "README.md", kind: "modified", additions: 1, deletions: 1 }],
    baselineMissing: false,
  });
  state.checkpoints = [
    {
      runId: RunId.make("run-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/root-1"),
      status: "missing",
      files: [],
      repositories: [repository("api"), repository("web")],
      assistantMessageId: null,
      completedAt: "2026-11-10T00:00:00.000Z",
    },
  ];
  state.checkpointDiff = {
    threadId: context.threadRef.threadId,
    fromTurnCount: 0,
    toTurnCount: 1,
    diff: "",
    repositories: ["api", "web"].map((name) => ({
      name,
      repositoryPath: `${cwd}/${name}`,
      relativePath: name,
      diff: patch("README.md"),
    })),
  };
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, width: 390, display: "flex", flexDirection: "column" }}>
        <DiffPanel
          mode="embedded"
          composerDraftTarget={context.threadRef}
          workspaceMutationId={null}
          visible
        />
      </div>
    </RegistryContext.Provider>,
  );
  const api = screen.getByRole("button", { name: "Collapse api/README.md", exact: true });
  const web = screen.getByRole("button", { name: "Collapse web/README.md", exact: true });
  await expect.element(api).toBeVisible();
  await expect.element(web).toBeVisible();
  // Both pickers keep their labels in a phone-width panel.
  await expect.element(screen.getByText("Latest turn", { exact: true })).toBeVisible();
  const picker = screen.getByRole("button", { name: "Repository: All repositories" });
  await expect.element(picker.getByText("All repositories")).toBeVisible();
  await userEvent.click(picker);
  await userEvent.click(page.getByRole("menuitemradio", { name: "web" }));
  await expect.element(web).toBeVisible();
  await expect.element(api).not.toBeInTheDocument();
});

// Paths as git's numstat reports them; the parsed patch keeps their edge whitespace.
it.each([
  { path: " leading.ts", name: " leading.ts" },
  { path: "src/trailing.ts ", name: "src/trailing.ts " },
])("reveals the turn file $path picked from the changed files", async ({ path, name }) => {
  using context = setup("origin/orphan");
  state.diffFilesCollapsed = true;
  state.checkpoints = [
    {
      runId: "run",
      checkpointTurnCount: 1,
      checkpointRef: "ref",
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-01-01T00:00:00Z",
    },
  ];
  state.checkpointDiff = {
    diff: `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\t\n@@ -0,0 +1 @@\n+revealed\n`,
  };
  useDiffPanelStore.getState().selectTurn(context.threadRef, RunId.make("run"), path);
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  await expect
    .element(screen.getByRole("button", { name: `Collapse ${name}`, exact: true }))
    .toHaveAttribute("aria-expanded", "true");
});

it("opens a file from a tool call's diff by the path its agent recorded", async () => {
  using context = setup("origin/orphan");
  // A local thread in a project that is the repository's apps/web folder.
  state.thread = { ...state.thread!, worktreePath: null };
  state.project = { workspaceRoot: "/repo/apps/web", repositoryIdentity: { rootPath: "/repo" } };
  const status = AsyncResult.getOrThrow(context.registry.get(state.status));
  state.status = Atom.make(
    AsyncResult.success({ ...status, workingTree: { ...status.workingTree, rootPath: "/repo" } }),
  );
  // Claude's Edit can record a path relative to the workspace, unlike the repository's diffs.
  state.toolCallItem = {
    type: "file_change",
    fileName: "src/a.ts",
    diffStr: "--- src/a.ts\n+++ src/a.ts\n@@ -1 +1 @@\n-before\n+after\n",
  };
  useDiffPanelStore.getState().selectToolCall(context.threadRef, {
    threadId: context.threadRef.threadId,
    itemId: TurnItemId.make("edit"),
    revision: "1",
  });
  await using screen = await render(
    <RegistryContext.Provider value={context.registry}>
      <div className="flex h-[600px] flex-col">
        <DiffPanel composerDraftTarget={context.threadRef} workspaceMutationId={null} visible />
      </div>
    </RegistryContext.Provider>,
  );
  await userEvent.click(screen.getByText("src/a.ts", { exact: true }));
  await vi.waitFor(() =>
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, context.threadRef),
    ).toMatchObject({ activeSurfaceId: "file:src/a.ts" }),
  );
});

it.each([
  { width: 1280, height: 800, opensOnTree: "true" },
  { width: 390, height: 844, opensOnTree: "false" },
])(
  "a large diff at $width px wide opens with the folder tree shown $opensOnTree until the person chooses otherwise",
  async ({ width, height, opensOnTree }) => {
    const filePatch = (index: number) => [
      `diff --git a/dir/file-${index}.txt b/dir/file-${index}.txt`,
      `--- a/dir/file-${index}.txt`,
      `+++ b/dir/file-${index}.txt`,
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ];
    const large = [...Array.from({ length: 120 }, (_, index) => filePatch(index)).flat(), ""];
    const treeChecked = async (stored: string | null) => {
      if (stored === null) localStorage.removeItem("t3code.diffFileTreeOpen");
      else localStorage.setItem("t3code.diffFileTreeOpen", stored);
      const view = await renderTurnPatch(large, 900);
      using _context = view.context;
      await using _screen = view.screen;
      await expect.element(view.screen.getByText(/^120 files$/)).toBeVisible();
      await view.screen.getByRole("button", { name: "View options" }).click();
      const item = page.getByRole("menuitemcheckbox", { name: "Show file tree" });
      await expect.element(item).toBeVisible();
      return item.element().getAttribute("aria-checked");
    };
    await page.viewport(width, height);
    onTestFinished(async () => {
      localStorage.removeItem("t3code.diffFileTreeOpen");
      await page.viewport(414, 896);
    });
    expect(await treeChecked(null)).toBe(opensOnTree);
    expect(await treeChecked("false")).toBe("false");
    expect(await treeChecked("true")).toBe("true");
  },
);
