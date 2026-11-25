import { describe, expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { useLatestRequestBusy } from "./useLatestRequestBusy";

function deferred() {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function Harness({ requests }: { readonly requests: readonly Promise<void>[] }) {
  const [busy, track] = useLatestRequestBusy();
  return (
    <div>
      <output aria-label="state">{busy ? "busy" : "idle"}</output>
      {requests.map((request, index) => (
        <button key={`start ${index + 1}`} type="button" onClick={() => void track(request)}>
          {`start ${index + 1}`}
        </button>
      ))}
    </div>
  );
}

describe("useLatestRequestBusy", () => {
  it("stays busy until the newest request settles even when an older one settles first", async () => {
    const first = deferred();
    const second = deferred();
    await using screen = await render(<Harness requests={[first.promise, second.promise]} />, {
      router: false,
    });
    await screen.getByRole("button", { name: "start 1" }).click();
    await screen.getByRole("button", { name: "start 2" }).click();
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("busy");

    await act(async () => {
      first.settle();
      await first.promise;
    });
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("busy");

    await act(async () => {
      second.settle();
      await second.promise;
    });
    await expect.element(screen.getByLabelText("state")).toHaveTextContent("idle");
  });
});
