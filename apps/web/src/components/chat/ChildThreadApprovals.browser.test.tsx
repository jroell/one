import { RegistryContext } from "@effect/atom-react";
import type { ChildThreadApproval } from "@t3tools/client-runtime/state/thread-requests";
import { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { peekApprovalDecision } from "~/one/approvalDecision";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ respond: vi.fn(), approvalsAtom: null as unknown }));

vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.respond }));
vi.mock("../../state/threads", () => ({
  childThreadApprovalsAtom: () => state.approvalsAtom,
  threadEnvironment: { respondToApproval: {} },
}));

import { ChildThreadApprovals } from "./ChildThreadApprovals";

function setup() {
  state.respond.mockReset();
  state.respond
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Child environment offline"))))
    .mockResolvedValueOnce(AsyncResult.success(undefined));
  const thread = {
    environmentId: EnvironmentId.make("child-env"),
    threadId: ThreadId.make("child"),
  };
  state.approvalsAtom = Atom.make<ReadonlyArray<ChildThreadApproval>>([
    {
      thread,
      title: "Compile task",
      approval: {
        requestId: RuntimeRequestId.make("approval"),
        requestKind: "command",
        detail: "Run compiler",
        createdAt: "2026-11-01T00:00:00.000Z",
        responseCapability: "live",
      },
    },
  ]);
  return thread;
}

it("shows a failed decision and clears the error when the user retries", async () => {
  const thread = setup();
  await using screen = await render(<ChildThreadApprovals threadRef={thread} />);
  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Child environment offline");
  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

it("drops the recorded answer of a child approval once it leaves the pending list", async () => {
  const thread = setup();
  state.respond.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  const registry = AtomRegistry.make();
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <ChildThreadApprovals threadRef={thread} />
    </RegistryContext.Provider>,
  );
  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  const requestId = RuntimeRequestId.make("approval");
  await vi.waitFor(() => expect(peekApprovalDecision(requestId)).toBe("accept"));
  // The request is answered: the environment no longer lists it.
  registry.set(state.approvalsAtom as Atom.Writable<ReadonlyArray<ChildThreadApproval>>, []);
  await vi.waitFor(() => expect(peekApprovalDecision(requestId)).toBeUndefined());
});
