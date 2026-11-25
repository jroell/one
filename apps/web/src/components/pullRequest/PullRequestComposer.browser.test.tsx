import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { PullRequestComposer } from "./PullRequestComposer";
import { pullRequestReviewKey, usePullRequestReviewStore } from "./pullRequestReviewStore";

import "~/index.css";

const pixel = (() => {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  return (color: string): [number, number, number] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0]!, data[1]!, data[2]!];
  };
})();

function luminance([r, g, b]: [number, number, number]) {
  const channel = (value: number) => {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(pixel(a)), luminance(pixel(b))].toSorted((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

it.each(["light", "dark"] as const)(
  "the pending-comment count on the composer keeps 4.5:1 white-on-fill contrast in %s",
  async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const reference = { projectId: ProjectId.make("test"), repository: "test/repo", number: 7 };
    const key = pullRequestReviewKey(reference);
    usePullRequestReviewStore.getState().clear(key);
    usePullRequestReviewStore.getState().addComment(key, {
      id: "one",
      body: "A note",
      path: "a.ts",
      position: { kind: "added", newLine: 1 },
    });
    try {
      await using screen = await render(
        <PullRequestComposer
          environmentId={EnvironmentId.make("test")}
          reference={reference}
          detail={
            {
              provider: "github",
              state: "open",
              capabilities: { comment: true, actions: [], review: { verdicts: [] } },
              viewerPermissions: { comment: true, actions: [], verdicts: [] },
            } as never
          }
          shownHeadSha="abc"
          actionPending={false}
          onCommentAction={async () => ({ commentPosted: true })}
          onCommented={() => {}}
          onReviewSubmitted={() => {}}
        />,
        { router: false },
      );
      const count = screen.container.querySelector("[data-one-badge-count]")!;
      const style = getComputedStyle(count);
      expect(count.textContent).toBe("1");
      expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    } finally {
      usePullRequestReviewStore.getState().clear(key);
      document.documentElement.classList.remove("dark");
    }
  },
);
