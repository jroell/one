import "~/index.css";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import * as follow from "./rowsBelowFollow";
import { WorkLogCollapse, WorkLogDetails } from "./WorkLog";

// The real helpers run; the spies only count the calls into the slide and measure path.
vi.mock(import("./rowsBelowFollow"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    openRowsBelow: vi.fn(actual.openRowsBelow),
    closeRowsBelow: vi.fn(actual.closeRowsBelow),
  };
});

const row = (index: number, open: boolean) => (
  <WorkLogCollapse key={index}>
    {open ? <WorkLogDetails>{`Details ${index}`}</WorkLogDetails> : null}
  </WorkLogCollapse>
);

it("measures nothing when many work rows mount already open, and moves the rows below only when a person opens or closes one", async () => {
  const rows = (openIndex: number | null) =>
    Array.from({ length: 40 }, (_, index) => row(index, index === 0 || index === openIndex));
  const getComputedStyleCalls = vi.spyOn(window, "getComputedStyle");
  await using screen = await render(<div>{rows(null)}</div>, { router: false });
  await vi.waitFor(() => expect(screen.container.textContent).toContain("Details 0"));
  // A thread switch mounts many rows; open ones are simply open.
  expect(vi.mocked(follow.openRowsBelow)).not.toHaveBeenCalled();
  expect(vi.mocked(follow.closeRowsBelow)).not.toHaveBeenCalled();
  expect(document.querySelector("[data-one-armed]")).toBeNull();
  expect(getComputedStyleCalls).not.toHaveBeenCalled();
  getComputedStyleCalls.mockRestore();
  // A person opens another row: that one row opens its slide.
  await screen.rerender(<div>{rows(5)}</div>);
  await vi.waitFor(() => expect(vi.mocked(follow.openRowsBelow)).toHaveBeenCalledTimes(1));
  // And closes it.
  await screen.rerender(<div>{rows(null)}</div>);
  await vi.waitFor(() => expect(vi.mocked(follow.closeRowsBelow)).toHaveBeenCalledTimes(1));
});
