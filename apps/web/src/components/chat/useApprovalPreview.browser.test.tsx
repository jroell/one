import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import type { ApprovalPreviewSource } from "./approvalHunk";
import { useApprovalPreview, type ApprovalPreviewState } from "./useApprovalPreview";

function Probe({
  source,
  seen,
}: {
  readonly source: ApprovalPreviewSource;
  readonly seen: ApprovalPreviewState[];
}) {
  const state = useApprovalPreview(source);
  seen.push(state);
  return (
    <p>
      {state.ready
        ? (state.preview?.lines.map((line) => (
            <span key={`${line.kind}:${line.text}`}>{line.text}</span>
          )) ?? "empty")
        : "pending"}
    </p>
  );
}

it("renders the card before the preview is computed, even for a tiny change", async () => {
  const seen: ApprovalPreviewState[] = [];
  await using screen = await render(
    <Probe seen={seen} source={{ oldStr: "a\nb\n", newStr: "a\nc\n" }} />,
    { router: false },
  );
  // The first render has no preview, so nothing was computed while rendering.
  expect(seen[0]).toEqual({ ready: false, preview: null });
  await expect.element(screen.getByText("a", { exact: true })).toBeVisible();
  expect(seen.at(-1)!.ready).toBe(true);
});

it("computes several previews one after another and gives each its own source's lines", async () => {
  const seen: ApprovalPreviewState[] = [];
  await using screen = await render(
    <>
      <Probe seen={seen} source={{ newStr: "first card\n" }} />
      <Probe seen={seen} source={{ newStr: "second card\n" }} />
      <Probe seen={seen} source={{ newStr: "third card\n" }} />
    </>,
    { router: false },
  );
  await expect.element(screen.getByText("first card")).toBeVisible();
  await expect.element(screen.getByText("second card")).toBeVisible();
  await expect.element(screen.getByText("third card")).toBeVisible();
});
