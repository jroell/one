import type { ProviderApprovalPushHooks } from "@t3tools/contracts";
import type * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/ai";

import * as McpInvocationContext from "./McpInvocationContext.ts";

/**
 * Where one tool call leaves its request for the client's input. A sessionless client is asked
 * by answering the call with that request; it calls the tool again with the person's answer.
 * `McpHttpServer` provides this around every call and sends what the handler left here.
 */
export class McpClientInput extends Context.Service<
  McpClientInput,
  {
    readonly request: Ref.Ref<McpSchema.InputRequired | undefined>;
    /** Where a thread's adapter finds what T3 Code asks through the thread's own client. */
    readonly sessions?: McpProviderSessions.McpProviderSessions["Service"] | undefined;
  }
>()("t3/mcp/McpClientInput") {}

/**
 * "asked": the request went out with this call's answer, so the handler ends now and runs again
 * when the client calls back. "unavailable": this client cannot ask a person anything.
 */
export type Approval = "accepted" | "declined" | "asked" | "unavailable";

const consentForm = { type: "object", properties: {} } as const;
const decodeElicitRequest = Schema.decodeEffect(McpSchema.ElicitRequestFormParams);

// A request left with a thread's session goes out with that record's id after its state, so the
// reply that comes with a later call ends that record and no other.
const RECORDED_STATE = /^(.*) request=([0-9a-f-]{36})$/s;
const recordedState = (state: string, id: string | undefined) =>
  id === undefined ? state : `${state} request=${id}`;
const sentState = (requestState: string) => {
  const match = RECORDED_STATE.exec(requestState);
  return match === null ? { state: requestState } : { state: match[1]!, id: match[2]! };
};

/**
 * The reply this call brings to `key`, with the `state` of the request it answers: what a
 * sessionless client sends when it calls again. A handler reads it before it does anything a
 * decline rules out. The request it answers is no longer waiting, so the thread's session
 * forgets it.
 */
export const answered = Effect.fn("McpClientInput.answered")(function* (key: string) {
  const context = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
  const answer = context?.inputResponses?.[key];
  if (answer === undefined || context?.requestState === undefined) return undefined;
  const { state, id } = sentState(context.requestState);
  const sessions = Option.getOrUndefined(yield* Effect.serviceOption(McpClientInput))?.sessions;
  const threadId = Option.getOrUndefined(
    yield* Effect.serviceOption(McpInvocationContext.McpInvocationContext),
  )?.thread?.threadId;
  if (sessions !== undefined && threadId !== undefined && id !== undefined) {
    yield* sessions.forgetApprovalRequest(threadId, id);
  }
  return { state, accepted: answer.action === "accept" };
});

/**
 * Asks the person behind the calling MCP client to approve `message`, by MCP elicitation.
 * `state` names what is being approved: an answer counts only for the state it was given for,
 * so asking again with another state asks the person again.
 */
export const askApproval = Effect.fn("McpClientInput.askApproval")(function* (input: {
  readonly key: string;
  readonly state: string;
  readonly message: string;
  readonly pushHooks?: ProviderApprovalPushHooks;
}): Effect.fn.Return<Approval> {
  const context = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
  const elicitation = context?.clientCapabilities.elicitation;
  // The request is a form. A client that names no mode takes forms; one naming only URLs does not.
  if (
    context === undefined ||
    elicitation === undefined ||
    (elicitation.form === undefined && elicitation.url !== undefined)
  ) {
    return "unavailable";
  }
  const params = { mode: "form", message: input.message, requestedSchema: consentForm } as const;
  const pending = Option.getOrUndefined(yield* Effect.serviceOption(McpClientInput));
  const threadId = Option.getOrUndefined(
    yield* Effect.serviceOption(McpInvocationContext.McpInvocationContext),
  )?.thread?.threadId;
  // A thread's client hands its adapter the message and a server name to show. The request is
  // left with the thread's MCP session too, so the adapter knows T3 Code asked it and what it names.
  const sessions = threadId === undefined ? undefined : pending?.sessions;
  const record =
    sessions === undefined || threadId === undefined
      ? Effect.undefined
      : sessions.recordApprovalRequest(threadId, {
          message: input.message,
          pushHooks: input.pushHooks,
        });
  const forget = (id: string | undefined) =>
    sessions === undefined || threadId === undefined || id === undefined
      ? Effect.void
      : sessions.forgetApprovalRequest(threadId, id);

  // A session: the server asks over it and waits here for the answer.
  const session = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpServerClient));
  if (session !== undefined) {
    const request = yield* decodeElicitRequest(params).pipe(Effect.orDie);
    const recorded = yield* record;
    return yield* session.getClient.pipe(
      Effect.flatMap((client) => client.elicit(request)),
      Effect.scoped,
      Effect.map(({ action }) => (action === "accept" ? "accepted" : "declined")),
      // A request that ends without an answer is not an approval.
      Effect.catchCause(() => Effect.succeed("declined" as const)),
      Effect.ensuring(forget(recorded)),
    );
  }

  if (pending === undefined) return "unavailable";
  const answer = context.inputResponses?.[input.key];
  const sent = context.requestState === undefined ? undefined : sentState(context.requestState);
  if (answer !== undefined && sent?.state === input.state) {
    yield* forget(sent.id);
    return answer.action === "accept" ? "accepted" : "declined";
  }
  const recorded = yield* record;
  yield* Ref.set(
    pending.request,
    new McpSchema.InputRequired({
      inputRequests: { [input.key]: { method: "elicitation/create", params } },
      requestState: recordedState(input.state, recorded),
    }),
  );
  return "asked";
});
