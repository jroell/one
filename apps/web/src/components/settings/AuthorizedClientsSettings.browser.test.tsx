import {
  EnvironmentId,
  managedCapabilityDenial,
  type ManagedPolicySummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import {
  AuthorizedClientsHeaderAction,
  RevokeOtherClientsAction,
} from "./AuthorizedClientsSettings";

const localId = EnvironmentId.make("local");
const serviceId = EnvironmentId.make("service");

const state = vi.hoisted(() => ({
  primaryEnvironmentId: null as string | null,
  policies: new Map<string, unknown>(),
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => state.primaryEnvironmentId) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useServerConfigs: (() =>
    new Map(
      [...state.policies].map(([environmentId, managedPolicy]) => [
        environmentId,
        { managedPolicy },
      ]),
    )) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));

const remoteClientsOff: ManagedPolicySummary = {
  organization: "Example Corp",
  lockedSettings: [],
  limits: { clients: ["desktop"] },
};

function setup(policies: ReadonlyArray<readonly [EnvironmentId, ManagedPolicySummary]>) {
  state.primaryEnvironmentId = localId;
  state.policies = new Map(policies);
}

const renderHeader = (environmentId: EnvironmentId) =>
  render(
    <AuthorizedClientsHeaderAction
      environmentId={environmentId}
      onPairingLinkCreated={() => {}}
      delegatableScopes={[]}
    />,
  );

describe("AuthorizedClientsHeaderAction", () => {
  const denial = managedCapabilityDenial(remoteClientsOff, "remoteClients")!;

  it("follows the selected service's policy, not the primary's", async () => {
    setup([[serviceId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("group", { name: denial })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
  });

  it("leaves pairing open on an unmanaged service when the primary is managed", async () => {
    setup([[localId, remoteClientsOff]]);
    await using screen = await renderHeader(serviceId);

    await expect.element(screen.getByRole("button", { name: "Create link" })).toBeEnabled();
    expect(screen.getByRole("group", { name: denial }).query()).toBeNull();
  });
});

describe("RevokeOtherClientsAction", () => {
  it("asks before it signs out the other clients, and leaves them alone on Cancel", async () => {
    const onRevoke = vi.fn();
    await using screen = await render(
      <RevokeOtherClientsAction
        clientSessions={[{ current: true }, { current: false }] as never}
        isRevoking={false}
        onRevoke={onRevoke}
      />,
    );

    await screen.getByRole("button", { name: "Revoke others" }).click();
    expect(onRevoke).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("status"))
      .toMatchTextContent("Sign out every other client?");

    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(onRevoke).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Revoke others" }).click();
    await screen.getByRole("button", { name: "Revoke others" }).click();
    expect(onRevoke).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus through the question: Cancel opens focused, and Cancel or Revoke returns to the launcher", async () => {
    const onRevoke = vi.fn();
    await using screen = await render(
      <RevokeOtherClientsAction
        clientSessions={[{ current: true }, { current: false }] as never}
        isRevoking={false}
        onRevoke={onRevoke}
      />,
    );
    const launcher = () => screen.getByRole("button", { name: "Revoke others" });
    const cancel = () => screen.getByRole("button", { name: "Cancel" });

    await vi.waitFor(() => launcher().element());
    (launcher().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(cancel()).toHaveFocus();
    await expect
      .element(screen.getByRole("status"))
      .toMatchTextContent("Sign out every other client?");

    await userEvent.keyboard("{Enter}");
    await expect.element(launcher()).toHaveFocus();
    await expect.element(screen.getByRole("status")).toHaveTextContent("");
    expect(onRevoke).not.toHaveBeenCalled();

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Tab}{Enter}");
    expect(onRevoke).toHaveBeenCalledOnce();
    await expect.element(launcher()).toHaveFocus();
  });

  it("has nothing to revoke while this is the only client", async () => {
    await using screen = await render(
      <RevokeOtherClientsAction
        clientSessions={[{ current: true }] as never}
        isRevoking={false}
        onRevoke={() => {}}
      />,
    );
    await expect.element(screen.getByRole("button", { name: "Revoke others" })).toBeDisabled();
  });
});
