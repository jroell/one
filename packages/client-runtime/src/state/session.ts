import { pipe } from "effect/Function";
import {
  type AuthEnvironmentScope,
  AuthSessionState,
  EnvironmentAuthInvalidError,
  type EnvironmentId,
  EnvironmentOperationForbiddenError,
  EnvironmentScopeRequiredError,
  type ServerConfig,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import type { RpcSession } from "../rpc/session.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { followStreamInEnvironment } from "./environmentStreams.ts";

/** @public Required to name the error in consumers' inferred session results. */
export class SessionHttpClientUnavailable extends Schema.TaggedError<SessionHttpClientUnavailable>()(
  "SessionHttpClientUnavailable",
  {},
) {}

function initialConfigOption<E>(
  initialConfig: Effect.Effect<ServerConfig, E>,
): Effect.Effect<Option.Option<ServerConfig>> {
  return initialConfig.pipe(
    Effect.asSome,
    Effect.catch((error) =>
      Effect.logWarning("Could not load the initial environment configuration.").pipe(
        Effect.annotateLogs({ ...safeErrorLogAttributes(error) }),
        Effect.as(Option.none<ServerConfig>()),
      ),
    ),
  );
}

const DEFAULT_SESSION_STATE_TIMEOUT_MS = 6_000;
const MAX_SESSION_STATE_TIMEOUT_MS = 60_000;
const SESSION_STATE_RETRY_BASE_MS = 2_000;
const SESSION_STATE_RETRY_MAX_MS = 60_000;

const isSessionRejectionError = Schema.is(
  Schema.Union([
    EnvironmentAuthInvalidError,
    EnvironmentScopeRequiredError,
    EnvironmentOperationForbiddenError,
  ]),
);
const isSessionResponse = Schema.is(AuthSessionState);
const isUndeclaredStatusError = Schema.is(RemoteEnvironmentAuthUndeclaredStatusError);
const isAuthFetchError = Schema.is(RemoteEnvironmentAuthFetchError);

/**
 * True only when the host said no: its session lacks the scope, or it rejected the credential.
 * A lookup that is still pending or failed on the network is not a denial.
 */
export function sessionDeniesScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  if (result._tag === "Success") return !sessionGrantsScope(result.value, scope);
  return result._tag === "Failure" && isSessionRejection(result.cause);
}

function isSessionRejection(cause: Cause.Cause<unknown>): boolean {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (isUndeclaredStatusError(error)) {
    return error.status === 401 || error.status === 403;
  }
  // A twice-rejected relay credential arrives wrapping the `authenticated: false` response.
  if (isAuthFetchError(error)) return isSessionResponse(error.cause);
  return isSessionRejectionError(error);
}

export const fetchEnvironmentSessionState = Effect.fn(
  "clientRuntime.state.fetchEnvironmentSessionState",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]
  >;
  readonly timeoutMs?: number;
}) {
  const request = (
    timeoutMs: number,
  ): Effect.Effect<AuthSessionState, RemoteEnvironmentRequestError, HttpClient.HttpClient> =>
    executeAuthenticatedEnvironmentHttpRequest({
      ...input,
      group: "auth",
      method: "GET",
      url: (urls) => urls.session(),
      timeoutMs,
      request: ({ client, headers }) => client.session({ headers }),
      // This endpoint returns 200 with authenticated:false for expired credentials.
      isUnauthorizedResponse: (response) => !response.authenticated,
    }).pipe(
      // A timeout says nothing about grants; failing would show a busy host as read-only.
      Effect.catchTags({
        RemoteEnvironmentAuthTimeoutError: (error) => {
          const nextTimeoutMs = Math.min(timeoutMs * 2, MAX_SESSION_STATE_TIMEOUT_MS);
          return nextTimeoutMs > timeoutMs ? request(nextTimeoutMs) : Effect.fail(error);
        },
      }),
    );
  return yield* request(input.timeoutMs ?? DEFAULT_SESSION_STATE_TIMEOUT_MS);
});

function makeEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const initialConfigAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) =>
              SubscriptionRef.changes(supervisor.session).pipe(
                Stream.mapEffect(
                  Option.match({
                    onNone: () => Effect.succeed(Option.none<ServerConfig>()),
                    onSome: (session) => initialConfigOption(session.initialConfig),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
      { initialValue: Option.none() },
    ),
  );

  // This is only the bootstrap config captured when a transport session is
  // established. Consumers that need current provider/settings state must use
  // createServerEnvironmentAtoms(...).configValueAtom instead.
  const initialConfigValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ServerConfig | null =>
      pipe(
        get(initialConfigAtom(environmentId)),
        AsyncResult.value,
        Option.flatten,
        Option.getOrNull,
      ),
    ).pipe(Atom.withLabel(`environment-config-value:${environmentId}`)),
  );

  const preparedConnectionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.prepared)),
          ),
        ),
      ),
      { initialValue: Option.none<PreparedConnection>() },
    ),
  );

  const preparedConnectionValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      AsyncResult.getOrElse(get(preparedConnectionAtom(environmentId)), () =>
        Option.none<PreparedConnection>(),
      ),
    ).pipe(Atom.withLabel(`environment-prepared-connection:${environmentId}`)),
  );

  const transportSessionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.session)),
          ),
        ),
      ),
      { initialValue: Option.none() },
    ),
  );

  const sessionStateAtom = Atom.family((environmentId: EnvironmentId) => {
    let consecutiveFailures = 0;
    let backoffConnection: RpcSession | null = null;
    return runtime
      .atom((get) => {
        const prepared = Option.getOrNull(get(preparedConnectionValueAtom(environmentId)));
        // Each established connection fetches anew, and a failure retries while it stays up,
        // so a fetch that failed mid-reconnect cannot outlive the socket that recovered.
        const connection = AsyncResult.getOrElse(get(transportSessionAtom(environmentId)), () =>
          Option.none(),
        );
        if (prepared === null || Option.isNone(connection)) {
          return Effect.never;
        }
        if (connection.value !== backoffConnection) {
          backoffConnection = connection.value;
          consecutiveFailures = 0;
        }
        return Effect.gen(function* () {
          const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
          const remoteAuthorization = yield* Effect.serviceOption(
            RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
          );
          const client = yield* Effect.serviceOption(HttpClient.HttpClient);
          if (Option.isNone(client)) return yield* new SessionHttpClientUnavailable();
          return yield* fetchEnvironmentSessionState({
            prepared,
            signer,
            remoteAuthorization,
          }).pipe(Effect.provideService(HttpClient.HttpClient, client.value));
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              consecutiveFailures = 0;
            }),
          ),
          Effect.tapError(() => {
            const delayMs = Math.min(
              SESSION_STATE_RETRY_BASE_MS * 2 ** consecutiveFailures,
              SESSION_STATE_RETRY_MAX_MS,
            );
            consecutiveFailures += 1;
            return Effect.sleep(delayMs).pipe(
              Effect.andThen(Effect.sync(() => get.refreshSelf())),
              Effect.forkScoped,
            );
          }),
        );
      })
      .pipe(
        Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
        Atom.setIdleTTL(5 * 60_000),
        Atom.withLabel(`environment-session-state:${environmentId}`),
      );
  });

  const sessionStateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): AuthSessionState | null =>
        AsyncResult.getOrElse(get(sessionStateAtom(environmentId)), () => null) ?? null,
    ).pipe(Atom.withLabel(`environment-session-state-value:${environmentId}`)),
  );

  return {
    initialConfigAtom,
    initialConfigValueAtom,
    preparedConnectionAtom,
    preparedConnectionValueAtom,
    sessionStateAtom,
    sessionStateValueAtom,
    transportSessionAtom,
  };
}

const sessionAtomsByRuntime = new WeakMap<object, ReturnType<typeof makeEnvironmentSessionAtoms>>();

export function createEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
): ReturnType<typeof makeEnvironmentSessionAtoms<R, E>> {
  const existing = sessionAtomsByRuntime.get(runtime);
  if (existing) return existing as ReturnType<typeof makeEnvironmentSessionAtoms<R, E>>;
  const atoms = makeEnvironmentSessionAtoms(runtime);
  sessionAtomsByRuntime.set(runtime, atoms);
  return atoms;
}

/**
 * Which authorization an environment's reads belong to. `generation` changes when the credential
 * does (replaced, signed out, paired again), not when the same credential reconnects; the last one
 * is kept while there is no connection. `confirmed` is true once a session check has answered for
 * that generation and stays so through a reconnect; the session atom keeps the old grant meanwhile.
 */
export interface EnvironmentAuthorization {
  readonly generation: string;
  readonly confirmed: boolean;
}

let nextGeneration = 0;
let nextConnectionId = 0;
const connectionIds = new WeakMap<object, number>();

/**
 * What identifies the grant a connection was prepared with: the bearer token, none, or the DPoP
 * signer. A DPoP connection that does not name its signer is told apart per connection, which is the
 * conservative reading.
 */
function credentialIdentity(prepared: PreparedConnection): string {
  const authorization = prepared.httpAuthorization;
  if (authorization === null) return "anonymous";
  if (authorization._tag === "Bearer") return `bearer:${authorization.token}`;
  if (prepared.credentialId !== undefined) return prepared.credentialId;
  let id = connectionIds.get(prepared);
  if (id === undefined) {
    id = nextConnectionId += 1;
    connectionIds.set(prepared, id);
  }
  return `connection:${id}`;
}

interface AuthorizationState {
  readonly identity: string;
  readonly generation: string;
  /** The session result that was already there when this generation began: it belongs to the last one. */
  readonly stale: unknown;
  confirmed: boolean;
}

export function createEnvironmentAuthorizationAtoms<E>(input: {
  readonly preparedConnectionValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Option.Option<PreparedConnection>>;
  readonly sessionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AuthSessionState, E>>;
}) {
  const states = new Map<EnvironmentId, AuthorizationState>();
  /**
   * The environment was removed. Whatever credential it comes back with, including the identical
   * one, is a new authorization: the next connection starts a generation nothing was kept under.
   */
  const removals = Atom.family((_environmentId: EnvironmentId) => Atom.make(0));
  const forget = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) => {
    const state = states.get(environmentId);
    if (state === undefined) return;
    states.set(environmentId, { ...state, identity: "removed" });
    registry.set(removals(environmentId), registry.get(removals(environmentId)) + 1);
  };
  const authorization = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): EnvironmentAuthorization => {
      get(removals(environmentId));
      const prepared = Option.getOrNull(get(input.preparedConnectionValueAtom(environmentId)));
      const result = get(input.sessionStateAtom(environmentId));
      let state = states.get(environmentId);
      if (prepared !== null) {
        const identity = credentialIdentity(prepared);
        if (state?.identity !== identity) {
          nextGeneration += 1;
          state = {
            identity,
            generation: `g${nextGeneration}`,
            stale: state === undefined ? null : result,
            confirmed: false,
          };
          states.set(environmentId, state);
        }
        if (AsyncResult.isSuccess(result) && !result.waiting && result !== state.stale) {
          state.confirmed = true;
        }
      }
      return state === undefined
        ? { generation: "none", confirmed: false }
        : { generation: state.generation, confirmed: state.confirmed };
    }).pipe(Atom.withLabel(`environment-authorization:${environmentId}`)),
  );
  return { authorization, forget };
}
