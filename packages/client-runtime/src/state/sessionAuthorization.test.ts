import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  PrimaryConnectionTarget,
  type PreparedConnection,
  type PreparedHttpAuthorization,
} from "../connection/model.ts";
import { createEnvironmentAuthorizationAtoms } from "./session.ts";

const ID = EnvironmentId.make("environment-1");
const TARGET = new PrimaryConnectionTarget({
  environmentId: ID,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const prepare = (token: string | null): PreparedConnection => ({
  environmentId: ID,
  label: TARGET.label,
  httpBaseUrl: "https://environment.example.test",
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: token === null ? null : { _tag: "Bearer", token },
  target: TARGET,
});
const prepareDpop = (accessToken: string, credentialId?: string): PreparedConnection => ({
  ...prepare("unused"),
  httpAuthorization: {
    _tag: "Dpop",
    accessToken,
    expiresAtEpochMs: 1,
  } satisfies PreparedHttpAuthorization,
  ...(credentialId === undefined ? {} : { credentialId }),
});
const GRANT = { authenticated: true } as unknown as AuthSessionState;

function harness() {
  const prepared = Atom.make<Option.Option<PreparedConnection>>(Option.none());
  const session = Atom.make<AsyncResult.AsyncResult<AuthSessionState, Error>>(
    AsyncResult.initial(true),
  );
  const atoms = createEnvironmentAuthorizationAtoms({
    preparedConnectionValueAtom: () => prepared,
    sessionStateAtom: () => session,
  });
  const authorization = atoms.authorization(ID);
  const registry = AtomRegistry.make();
  registry.subscribe(authorization, () => {});
  return {
    remove: () => atoms.forget(registry, ID),
    read: () => registry.get(authorization),
    prepare: (connection: PreparedConnection | null) =>
      registry.set(prepared, connection === null ? Option.none() : Option.some(connection)),
    session: (result: AsyncResult.AsyncResult<AuthSessionState, Error>) =>
      registry.set(session, result),
  };
}

describe("environment authorization generation", () => {
  it("is unconfirmed until the session check answers for the connection", () => {
    const h = harness();
    expect(h.read()).toEqual({ generation: "none", confirmed: false });
    h.prepare(prepare("first"));
    expect(h.read().confirmed).toBe(false);
    h.session(AsyncResult.success(GRANT));
    expect(h.read().confirmed).toBe(true);
  });

  it("changes generation when the credentials are replaced and is unconfirmed while the replacement check is pending", () => {
    const h = harness();
    h.prepare(prepare("first"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();

    h.prepare(prepare("second"));
    // The session atom keeps the old grant while its replacement request is in flight.
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    const pending = h.read();
    expect(pending.generation).not.toBe(before.generation);
    expect(pending.confirmed).toBe(false);

    h.session(AsyncResult.success(GRANT));
    expect(h.read()).toEqual({ generation: pending.generation, confirmed: true });
  });

  it("keeps the same generation, still confirmed, through a background revalidation", () => {
    const h = harness();
    h.prepare(prepare("first"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    expect(h.read()).toEqual(before);
  });

  it("keeps the generation and the confirmation through a reconnect with the same credential", () => {
    const h = harness();
    h.prepare(prepare("first"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();

    h.prepare(null);
    expect(h.read()).toEqual(before);

    h.prepare(prepare("first"));
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    expect(h.read()).toEqual(before);
  });

  it("gives a credential that is replaced, signed out or paired again a generation it never had", () => {
    const h = harness();
    h.prepare(prepare("first"));
    h.session(AsyncResult.success(GRANT));
    const seen = new Set([h.read().generation]);

    for (const next of ["second", null, "third"]) {
      h.prepare(null);
      h.prepare(prepare(next));
      h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
      const now = h.read();
      expect(seen.has(now.generation)).toBe(false);
      expect(now.confirmed).toBe(false);
      seen.add(now.generation);
      h.session(AsyncResult.success(GRANT));
    }
  });

  it("keeps the generation through a DPoP token renewal and reconnect that name the same signer", () => {
    const h = harness();
    h.prepare(prepareDpop("token-1", "dpop:signer-1"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();

    h.prepare(null);
    h.prepare(prepareDpop("token-2", "dpop:signer-1"));
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    expect(h.read()).toEqual(before);
  });

  it("changes the generation when the DPoP signer changes", () => {
    const h = harness();
    h.prepare(prepareDpop("token-1", "dpop:signer-1"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();

    h.prepare(prepareDpop("token-1", "dpop:signer-2"));
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    expect(h.read().generation).not.toBe(before.generation);
    expect(h.read().confirmed).toBe(false);
  });

  it("treats a DPoP connection that does not name its signer as a new credential each time", () => {
    const h = harness();
    h.prepare(prepareDpop("token-1"));
    h.session(AsyncResult.success(GRANT));
    const before = h.read();
    h.prepare(prepareDpop("token-1"));
    h.session(AsyncResult.waiting(AsyncResult.success(GRANT)));
    expect(h.read().generation).not.toBe(before.generation);
  });

  it("starts a new unconfirmed generation when a removed environment returns with the identical credential", () => {
    const h = harness();
    const credential = prepare("first");
    h.prepare(credential);
    h.session(AsyncResult.success(GRANT));
    const before = h.read();

    h.remove();
    h.prepare(null);
    h.prepare(credential);
    const back = h.read();
    expect(back.generation).not.toBe(before.generation);
    expect(back.confirmed).toBe(false);

    h.session(AsyncResult.success({ ...GRANT }));
    expect(h.read()).toEqual({ generation: back.generation, confirmed: true });
  });
});
