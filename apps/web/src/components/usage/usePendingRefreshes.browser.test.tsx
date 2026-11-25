import { describe, expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { anyRefreshPending, usePendingRefreshes } from "./usePendingRefreshes";

function deferred() {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function Harness({
  requests,
  selected,
}: {
  readonly requests: Readonly<Record<string, Promise<void>>>;
  readonly selected: readonly string[];
}) {
  const [pending, track] = usePendingRefreshes();
  return (
    <div>
      <output aria-label="state">{anyRefreshPending(pending, selected) ? "busy" : "idle"}</output>
      {Object.entries(requests).map(([environmentId, request]) => (
        <button
          key={environmentId}
          type="button"
          onClick={() => void track(environmentId, request)}
        >
          {`refresh ${environmentId}`}
        </button>
      ))}
    </div>
  );
}

describe("usePendingRefreshes", () => {
  it("stays busy for the selection while one environment is pending, however the others settle", async () => {
    const a = deferred();
    const b = deferred();
    const requests = { A: a.promise, B: b.promise };
    await using screen = await render(<Harness requests={requests} selected={["A", "B"]} />, {
      router: false,
    });
    await screen.getByRole("button", { name: "refresh A" }).click();
    await screen.getByRole("button", { name: "refresh B" }).click();

    // B finishes first: an aggregate over both would be done, but A is still pending.
    await act(async () => {
      b.settle();
      await b.promise;
    });
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("busy");

    await act(async () => {
      a.settle();
      await a.promise;
    });
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("idle");
  });

  it("shows nothing for a selection with no connected environment, or only finished ones", async () => {
    const a = deferred();
    const requests = { A: a.promise };
    await using screen = await render(<Harness requests={requests} selected={["A"]} />, {
      router: false,
    });
    await screen.getByRole("button", { name: "refresh A" }).click();
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("busy");

    // The user selects only machines that are disconnected: the old refresh is not theirs.
    await screen.rerender(<Harness requests={requests} selected={[]} />);
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("idle");
    await screen.rerender(<Harness requests={requests} selected={["B"]} />);
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("idle");
  });
});
