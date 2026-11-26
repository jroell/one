import {
  EnvironmentId,
  managedCapabilityDenial,
  type ManagedPolicySummary,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import {
  AuthorizedClientsHeaderAction,
  RevokeOtherClientsAction,
} from "./AuthorizedClientsSettings";
import { revokeOthersOutcome, type RevokeOthersOutcome } from "./ConnectionsSettings.logic";

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

  it("brings the question and its two buttons in together: the same animation, the same 60 ms content delay", async () => {
    await using screen = await render(
      <RevokeOtherClientsAction
        clientSessions={[{ current: true }, { current: false }] as never}
        isRevoking={false}
        onRevoke={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: "Revoke others" }).click();

    const question = screen.getByRole("status").element().firstElementChild!;
    const buttons = screen.getByRole("button", { name: "Cancel" }).element().parentElement!;
    for (const part of [question, buttons]) {
      const style = getComputedStyle(part);
      expect(style.animationName).toBe("settings-swap-in");
      expect(style.animationDelay).toBe("0.06s");
    }
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

  /**
   * The parent the real page is: it sets isRevoking before its first await, holds the request, and
   * turns the settled result into an outcome with the page's own function.
   */
  function pendingRevoke() {
    let settle: (result: AtomCommandResult<unknown, unknown>) => void = () => {};
    function Parent() {
      const [revoking, setRevoking] = useState(false);
      const [sessions, setSessions] = useState([{ current: true }, { current: false }]);
      const [outcome, setOutcome] = useState<RevokeOthersOutcome | null>(null);
      return (
        <RevokeOtherClientsAction
          clientSessions={sessions as never}
          isRevoking={revoking}
          outcome={outcome}
          onRevoke={() => {
            setRevoking(true);
            setOutcome(null);
            void new Promise<AtomCommandResult<unknown, unknown>>((resolve) => {
              settle = resolve;
            }).then((result) => {
              const next = revokeOthersOutcome(result, (error) =>
                error instanceof Error ? error.message : "unknown",
              );
              if (next.kind === "revoked") setSessions([{ current: true }]);
              setOutcome(next);
              setRevoking(false);
            });
          }}
        />
      );
    }
    return { Parent, settle: (result: AtomCommandResult<unknown, unknown>) => settle(result) };
  }

  async function confirmByKeyboard(screen: Awaited<ReturnType<typeof render>>) {
    await vi.waitFor(() => screen.getByRole("button", { name: "Revoke others" }).element());
    (screen.getByRole("button", { name: "Revoke others" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Tab}{Enter}");
  }

  it("keeps focus on the status line through a pending revoke and announces pending, then finished", async () => {
    const { Parent, settle } = pendingRevoke();
    await using screen = await render(<Parent />);
    const status = () => screen.getByRole("status");

    await confirmByKeyboard(screen);

    await expect.element(status()).toMatchTextContent("Revoking other clients…");
    await expect.element(status()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    await act(async () => settle(AsyncResult.success(1)));
    await expect.element(status()).toMatchTextContent("Other clients signed out.");
    await expect.element(status()).toHaveFocus();
    // No other client is left, so the launcher ends up disabled.
    await expect.element(screen.getByRole("button", { name: "Revoke others" })).toBeDisabled();
  });

  it("says why a revoke failed on the same line", async () => {
    const { Parent, settle } = pendingRevoke();
    await using screen = await render(<Parent />);
    await confirmByKeyboard(screen);
    await act(async () =>
      settle(AsyncResult.failure(Cause.fail(new Error("The server did not answer.")))),
    );
    await expect
      .element(screen.getByRole("status"))
      .toMatchTextContent("The server did not answer.");
    await expect.element(screen.getByRole("status")).toHaveFocus();
  });

  it("does not report a revoke the session interrupted as a success", async () => {
    const { Parent, settle } = pendingRevoke();
    await using screen = await render(<Parent />);
    await confirmByKeyboard(screen);
    await act(async () => settle(AsyncResult.failure(Cause.interrupt())));
    await expect
      .element(screen.getByRole("status"))
      .toMatchTextContent("Stopped before the other clients were signed out.");
    expect(screen.getByRole("status").element().textContent).not.toContain(
      "Other clients signed out.",
    );
    // The other client is still there to revoke.
    await expect.element(screen.getByRole("button", { name: "Revoke others" })).toBeEnabled();
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
