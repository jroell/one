import {
  EnvironmentId,
  managedCapabilityDenial,
  type ManagedPolicySummary,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
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

  it("keeps keyboard focus through the question: Cancel opens focused and returns to the launcher", async () => {
    await using screen = await render(
      <RevokeOtherClientsAction
        clientSessions={[{ current: true }, { current: false }] as never}
        isRevoking={false}
        onRevoke={vi.fn()}
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
  });

  it("keeps focus on the status line through a real pending revoke, and announces the pending and finished states", async () => {
    // The parent sets isRevoking before its first await and clears it when the request settles,
    // and the list has no other client afterwards, so the launcher ends up disabled.
    let settle: (error: string | null) => void = () => {};
    function Parent() {
      const [revoking, setRevoking] = useState(false);
      const [sessions, setSessions] = useState([{ current: true }, { current: false }]);
      const [error, setError] = useState<string | null>(null);
      return (
        <RevokeOtherClientsAction
          clientSessions={sessions as never}
          isRevoking={revoking}
          error={error}
          onRevoke={() => {
            setRevoking(true);
            setError(null);
            void new Promise<string | null>((resolve) => {
              settle = resolve;
            }).then((failure) => {
              if (failure === null) setSessions([{ current: true }]);
              setError(failure);
              setRevoking(false);
            });
          }}
        />
      );
    }
    await using screen = await render(<Parent />);
    const status = () => screen.getByRole("status");

    await vi.waitFor(() => screen.getByRole("button", { name: "Revoke others" }).element());
    (screen.getByRole("button", { name: "Revoke others" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Tab}{Enter}");

    await expect.element(status()).toMatchTextContent("Revoking other clients…");
    await expect.element(status()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    await act(async () => settle(null));
    await expect.element(status()).toMatchTextContent("Other clients signed out.");
    await expect.element(status()).toHaveFocus();
    await expect.element(screen.getByRole("button", { name: "Revoke others" })).toBeDisabled();
  });

  it("says why a revoke failed on the same line", async () => {
    let settle: (error: string | null) => void = () => {};
    function Parent() {
      const [revoking, setRevoking] = useState(false);
      const [error, setError] = useState<string | null>(null);
      return (
        <RevokeOtherClientsAction
          clientSessions={[{ current: true }, { current: false }] as never}
          isRevoking={revoking}
          error={error}
          onRevoke={() => {
            setRevoking(true);
            void new Promise<string | null>((resolve) => {
              settle = resolve;
            }).then((failure) => {
              setError(failure);
              setRevoking(false);
            });
          }}
        />
      );
    }
    await using screen = await render(<Parent />);
    await vi.waitFor(() => screen.getByRole("button", { name: "Revoke others" }).element());
    (screen.getByRole("button", { name: "Revoke others" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Tab}{Enter}");
    await act(async () => settle("The server did not answer."));
    await expect
      .element(screen.getByRole("status"))
      .toMatchTextContent("The server did not answer.");
    await expect.element(screen.getByRole("status")).toHaveFocus();
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
