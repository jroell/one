import { RegistryContext } from "@effect/atom-react";
import {
  AuthDiagnosticsReadScope,
  type AuthSessionState,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { UsagePage } from "./UsagePage";
import { saveUsagePagePreferences } from "./usagePagePreferences";
import { summary } from "./usageFixtures";

// Only the transport is replaced: which environments exist, their session check, their prepared
// connection and the usage responses, all of which a test can hold. The hook, the atoms that derive
// figures from them, the authorization generation, the page and its figure cache are the real ones.
const transport = await vi.hoisted(async () => {
  const { Option } = await import("effect");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  type Writable<A> = ReturnType<typeof Atom.make<A>>;
  const sessions = new Map<string, Writable<unknown>>();
  const prepared = new Map<string, Writable<unknown>>();
  const filters = new Map<string, Writable<unknown>>();
  const answers = new Map<string, { environmentId: string; atom: Writable<unknown> }>();
  // A writable atom forgets its value once nobody reads it, which a closed page must not cause.
  const kept = <A,>(atom: Writable<A>) => atom.pipe(Atom.keepAlive) as Writable<A>;
  const own = <A,>(map: Map<string, Writable<A>>, key: string, make: () => Writable<A>) => {
    let atom = map.get(key);
    if (atom === undefined) {
      atom = make();
      map.set(key, atom);
    }
    return atom;
  };
  return {
    presentations: kept(Atom.make(new Map<string, unknown>())),
    session: (id: string) =>
      own(sessions, id, () => kept(Atom.make<unknown>(AsyncResult.initial(true)))),
    prepared: (id: string) => own(prepared, id, () => kept(Atom.make<unknown>(Option.none()))),
    filter: (id: string) => own(filters, id, () => kept(Atom.make<unknown>(undefined))),
    answer: (environmentId: string, input: unknown) => {
      const key = `${environmentId}|${JSON.stringify(input)}`;
      let entry = answers.get(key);
      if (entry === undefined) {
        entry = { environmentId, atom: kept(Atom.make<unknown>(AsyncResult.initial(true))) };
        answers.set(key, entry);
      }
      return entry.atom;
    },
    answersOf: (environmentId: string) =>
      [...answers.values()].filter((entry) => entry.environmentId === environmentId),
  };
});

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: string) => transport.session(id),
      preparedConnectionValueAtom: (id: string) => transport.prepared(id),
    })) as never,
  };
});
vi.mock(import("../../state/presentation"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentPresentations: {
      ...actual.environmentPresentations,
      presentationsAtom: transport.presentations,
    },
  } as never;
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      usageSummary: (({ environmentId, input }: { environmentId: string; input: unknown }) =>
        transport.answer(environmentId, input)) as never,
      usageModelFilterAtom: ((id: string) => transport.filter(id)) as never,
    },
  };
});
vi.mock(import("@t3tools/client-runtime/state/usage"), async (original) => ({
  ...(await original()),
  refreshUsage: async () => undefined,
}));

const { AsyncResult, Atom } = await import("effect/reactivity");
const Option = await import("effect/Option");

const grant = (scopes: readonly string[]): AuthSessionState =>
  ({
    authenticated: true,
    scopes,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token"],
      sessionCookieName: "t3_session",
    },
  }) as unknown as AuthSessionState;
const GRANTED = grant([AuthDiagnosticsReadScope]);
const REVOKED = grant([]);

let credentialsCounter = 0;
/** A prepared connection; the token is the credential, `null` is a signed-out connection. */
const credentials = (id: string, token: string | null = `token-${(credentialsCounter += 1)}`) =>
  ({
    environmentId: id,
    label: id,
    httpBaseUrl: "https://environment.example.test",
    socketUrl: "wss://environment.example.test/ws",
    httpAuthorization: token === null ? null : { _tag: "Bearer", token },
    target: { _tag: "PrimaryConnectionTarget", environmentId: id, label: id },
  }) as never;

/** A DPoP connection: the access token renews, the signer's thumbprint names the credential. */
const dpopCredentials = (id: string, signer: string, accessToken: string) =>
  ({
    environmentId: id,
    label: id,
    httpBaseUrl: "https://environment.example.test",
    socketUrl: "wss://environment.example.test/ws",
    httpAuthorization: { _tag: "Dpop", accessToken, expiresAtEpochMs: Number.MAX_SAFE_INTEGER },
    credentialId: `dpop:${signer}`,
    target: { _tag: "RelayConnectionTarget", environmentId: id, label: id },
  }) as never;

const set = (atom: unknown, value: unknown) =>
  appAtomRegistry.set(atom as ReturnType<typeof Atom.make<unknown>>, value);

const presentation = (id: string, phase = "connected") => ({
  connection: { phase, error: null, traceId: null },
  entry: { target: { label: id } },
});

function setEnvironments(ids: readonly string[], phase = "connected") {
  set(transport.presentations, new Map(ids.map((id) => [id, presentation(id, phase)])));
}

function settle(id: string, value: UsageSummary) {
  for (const { atom } of transport.answersOf(id)) set(atom, AsyncResult.success(value));
}

/** The environment's response for its current query is back to waiting, with nothing yet. */
function holdResponse(id: string) {
  for (const { atom } of transport.answersOf(id)) set(atom, AsyncResult.initial(true));
}

function connect(id: string, session: AuthSessionState = GRANTED, token?: string) {
  set(transport.prepared(id), Option.some(credentials(id, token)));
  set(transport.session(id), AsyncResult.success(session));
}

interface Pair {
  readonly a: string;
  readonly b: string;
}
let pairCounter = 0;
function pair(): Pair {
  pairCounter += 1;
  return { a: `gen-a-${pairCounter}`, b: `gen-b-${pairCounter}` };
}

function openPage() {
  saveUsagePagePreferences({ metric: "cost", windowDays: 30, hiddenProviders: [] });
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <UsagePage />
    </RegistryContext.Provider>,
    { router: "/usage" },
  );
}

/** Two machines, both authorized, both answered: the page shows their $100.00 together. */
async function openAnswered({ a, b }: Pair, kind: "bearer" | "dpop" = "bearer") {
  setEnvironments([a, b]);
  if (kind === "bearer") {
    connect(a, GRANTED, `first-${a}`);
    connect(b, GRANTED, `first-${b}`);
  } else {
    for (const id of [a, b]) {
      set(transport.prepared(id), Option.some(dpopCredentials(id, `signer-${id}`, "access-1")));
      set(transport.session(id), AsyncResult.success(GRANTED));
    }
  }
  const screen = await openPage();
  await act(async () => {
    settle(a, summary(a, [["codex", 40]]));
    settle(b, summary(b, [["claude", 60]]));
  });
  await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
  return screen;
}

const SHOWS_NO_FIGURES = async () => {
  await expect.element(page.getByText("Reading usage…")).toBeVisible();
  expect(document.body.textContent).not.toContain("$100.00");
};

/**
 * Holds every machine's response (the figures carry over, as they should), applies `event` while
 * the page is open, then closes and reopens the page: neither may show the old $100.00.
 */
async function expectNoReplay(ids: Pair, event: () => void | Promise<void>) {
  await using first = await openAnswered(ids);
  await act(async () => {
    holdResponse(ids.a);
    holdResponse(ids.b);
  });
  await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
  await act(async () => {
    await event();
  });
  await SHOWS_NO_FIGURES();

  await first.unmount();
  await using _second = await openPage();
  await SHOWS_NO_FIGURES();
}

describe("Usage figures across a change of authorization", () => {
  it("replays the figures while the same machines only refresh, in the open page and on reopening", async () => {
    const ids = pair();
    await using first = await openAnswered(ids);
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();

    await first.unmount();
    await using _second = await openPage();
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
  });

  it("keeps the figures through a reconnect with the same credential, until the check says revoked", async () => {
    const ids = pair();
    await using first = await openAnswered(ids);
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
      // The connection drops and comes back with the credential it had; its check is held.
      setEnvironments([ids.a, ids.b], "connecting");
      for (const id of [ids.a, ids.b]) set(transport.prepared(id), Option.none());
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await act(async () => {
      setEnvironments([ids.a, ids.b]);
      for (const id of [ids.a, ids.b]) {
        set(transport.prepared(id), Option.some(credentials(id, `first-${id}`)));
        set(transport.session(id), AsyncResult.waiting(AsyncResult.success(GRANTED)));
      }
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await expect.element(page.getByText("Updating…")).toBeVisible();

    // Closed and reopened while the check is still held: the kept figures are still the same view.
    await first.unmount();
    await using reopened = await openPage();
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();

    await act(async () => {
      for (const id of [ids.a, ids.b]) set(transport.session(id), AsyncResult.success(GRANTED));
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();

    await act(async () => set(transport.session(ids.a), AsyncResult.success(REVOKED)));
    await SHOWS_NO_FIGURES();
    await reopened.unmount();
  });

  it("keeps the figures through a DPoP reconnect with the same signer and a renewed access token", async () => {
    const ids = pair();
    await using first = await openAnswered(ids, "dpop");
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
      for (const id of [ids.a, ids.b]) set(transport.prepared(id), Option.none());
    });
    await act(async () => {
      for (const id of [ids.a, ids.b]) {
        set(
          transport.prepared(id),
          Option.some(dpopCredentials(id, `signer-${id}`, "access-renewed")),
        );
        set(transport.session(id), AsyncResult.waiting(AsyncResult.success(GRANTED)));
      }
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await expect.element(page.getByText("Updating…")).toBeVisible();

    await first.unmount();
    await using reopened = await openPage();
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();

    await act(async () => {
      for (const id of [ids.a, ids.b]) set(transport.session(id), AsyncResult.success(GRANTED));
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await reopened.unmount();
  });

  it("drops the figures when a DPoP reconnect comes back with a different signer", async () => {
    const ids = pair();
    await using _screen = await openAnswered(ids, "dpop");
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await act(async () => {
      set(
        transport.prepared(ids.a),
        Option.some(dpopCredentials(ids.a, "another-signer", "access-1")),
      );
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
    });
    await SHOWS_NO_FIGURES();
  });

  it("shows no kept figures for a machine removed and added again with the identical token while Usage was closed", async () => {
    const ids = pair();
    await using first = await openAnswered(ids);
    await first.unmount();

    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
      setEnvironments([ids.b]);
    });
    await act(async () => setEnvironments([ids.a, ids.b]));

    await using _reopened = await openPage();
    await SHOWS_NO_FIGURES();
  });

  it("drops the figures when a reconnect comes back with a different credential", async () => {
    const ids = pair();
    await using _screen = await openAnswered(ids);
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
      set(transport.prepared(ids.a), Option.none());
    });
    await expect.element(page.getByText(/of \$100\.00 in the last/)).toBeVisible();
    await act(async () => {
      set(transport.prepared(ids.a), Option.some(credentials(ids.a, "someone-else")));
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
    });
    await SHOWS_NO_FIGURES();
  });

  it("shows no figures after a machine's grant is revoked while the other one's response is held", async () => {
    const ids = pair();
    await expectNoReplay(ids, () => set(transport.session(ids.a), AsyncResult.success(REVOKED)));
  });

  it("shows no figures after a machine's credentials are replaced while its session check is held", async () => {
    const ids = pair();
    await expectNoReplay(ids, () => {
      set(transport.prepared(ids.a), Option.some(credentials(ids.a)));
      // The session atom keeps the old grant while the replacement request is pending.
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
    });
  });

  it("shows no figures after a machine is removed, and none when it is paired again with its check held", async () => {
    const ids = pair();
    await using first = await openAnswered(ids);
    await act(async () => {
      setEnvironments([ids.b]);
      set(transport.prepared(ids.a), Option.none());
      holdResponse(ids.b);
    });
    await SHOWS_NO_FIGURES();
    await first.unmount();

    // Paired again: same id, new credentials, check held, and its old response still waiting.
    await act(async () => {
      setEnvironments([ids.a, ids.b]);
      set(transport.prepared(ids.a), Option.some(credentials(ids.a)));
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
      for (const { atom } of transport.answersOf(ids.a)) {
        set(atom, AsyncResult.waiting(AsyncResult.success(summary(ids.a, [["codex", 40]]))));
      }
    });
    await using reopened = await openPage();
    await SHOWS_NO_FIGURES();
    await reopened.unmount();

    // Its check has answered under the new credentials and its response is still held.
    await act(async () => {
      set(transport.session(ids.a), AsyncResult.success(GRANTED));
      holdResponse(ids.a);
      holdResponse(ids.b);
    });
    await using _confirmed = await openPage();
    await SHOWS_NO_FIGURES();
  });

  it("does not bring back the figures of a machine that was removed and returns with its old credential", async () => {
    const ids = pair();
    await using _screen = await openAnswered(ids);
    await act(async () => {
      holdResponse(ids.a);
      holdResponse(ids.b);
      setEnvironments([ids.b]);
    });
    await SHOWS_NO_FIGURES();
    await act(async () => setEnvironments([ids.a, ids.b]));
    await SHOWS_NO_FIGURES();
  });

  it("shows only fresh figures once a replaced machine's check and response have both answered", async () => {
    const ids = pair();
    await using _first = await openAnswered(ids);
    await act(async () => {
      set(transport.prepared(ids.a), Option.some(credentials(ids.a)));
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
      holdResponse(ids.b);
      // The old response is still there, waiting, when the check answers.
      for (const { atom } of transport.answersOf(ids.a)) {
        set(atom, AsyncResult.waiting(AsyncResult.success(summary(ids.a, [["codex", 40]]))));
      }
    });
    await act(async () => set(transport.session(ids.a), AsyncResult.success(GRANTED)));
    await SHOWS_NO_FIGURES();

    await act(async () => {
      settle(ids.a, summary(ids.a, [["codex", 50]]));
      settle(ids.b, summary(ids.b, [["claude", 60]]));
    });
    await expect.element(page.getByText(/of \$110\.00 in the last/)).toBeVisible();
  });

  it("shows nothing from a replaced machine whose response arrives before its session check", async () => {
    const ids = pair();
    await using _screen = await openAnswered(ids);
    await act(async () => {
      set(transport.prepared(ids.a), Option.some(credentials(ids.a)));
      set(transport.session(ids.a), AsyncResult.waiting(AsyncResult.success(GRANTED)));
      settle(ids.a, summary(ids.a, [["codex", 50]]));
      holdResponse(ids.b);
    });
    expect(document.body.textContent).not.toContain("$50.00");
    expect(document.body.textContent).not.toContain("$110.00");

    await act(async () => set(transport.session(ids.a), AsyncResult.success(GRANTED)));
    await act(async () => settle(ids.a, summary(ids.a, [["codex", 50]])));
    await expect.element(page.getByText(/\$50\.00/).first()).toBeVisible();
  });

  it("closes the chart tooltip on the first Escape and the Usage dialog only on the second", async () => {
    await using _screen = await openAnswered(pair());
    const plot = document.querySelector<HTMLElement>(".usage-plot")!;
    plot.focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(document.querySelector(".usage-tooltip")).not.toBeNull());

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector(".usage-tooltip")).toBeNull());
    // A dismissed dialog starts its exit transition at once, so it never does within this window.
    const dialog = () => document.querySelector('[role="dialog"]')!;
    await expect(
      vi.waitFor(() => expect(dialog().hasAttribute("data-ending-style")).toBe(true), {
        timeout: 400,
      }),
    ).rejects.toThrow();

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("shows no figures after signing out", async () => {
    const ids = pair();
    await expectNoReplay(ids, () => {
      for (const id of [ids.a, ids.b]) {
        // Signed out: the connection comes back with no credential, and its check has not answered.
        set(transport.prepared(id), Option.some(credentials(id, null)));
        set(transport.session(id), AsyncResult.initial(true));
      }
      setEnvironments([ids.a, ids.b], "connecting");
    });
  });

  it("shows no figures after the model filter of a machine changes", async () => {
    const ids = pair();
    await expectNoReplay(ids, () => set(transport.filter(ids.a), { include: ["only-this-model"] }));
  });

  it("shows no figures when the page is reopened in another time zone", async () => {
    const ids = pair();
    await using first = await openAnswered(ids);
    await first.unmount();

    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...original.call(this), timeZone: "Pacific/Kiritimati" };
      });
    try {
      await using _reopened = await openPage();
      await SHOWS_NO_FIGURES();
    } finally {
      spy.mockRestore();
    }
  });
});
