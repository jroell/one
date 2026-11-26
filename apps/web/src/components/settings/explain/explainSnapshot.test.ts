import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { m } from "../../../i18n/messages";
import { buildHiddenContext } from "./explainConversation";
import {
  buildSetupSnapshot,
  MAX_FREE_TEXT_CHARS,
  plainFreeText,
  withoutSecretShapes,
} from "./explainSnapshot";
import { EXPLAIN_TOPIC_IDS, explainTopic } from "./explainTopics";

const API_KEY = "sk-proj-9fA2kLmQ7xZr0Tb4WcVe8NuYh1";
const TOKEN = "ghp_1234567890abcdefghijklmnopqrstuv";
const MANAGEMENT_KEY = "mgmt_k3y_value_that_is_long_enough_9876";
const EMAIL = "person@example.com";
const ACCOUNT_ID = "acct_8f3b2c1d4e5f60718293a4b5c6d7e8f9";

const provider = (overrides: Record<string, unknown>) =>
  ({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    status: "ready",
    auth: {
      status: "authenticated",
      type: "chatgpt",
      label: "ChatGPT Pro 200 Subscription",
      email: EMAIL,
    },
    models: [],
    slashCommands: [],
    skills: [],
    checkedAt: "2026-07-24T12:00:00.000Z",
    version: "1.0.0",
    ...overrides,
  }) as unknown as ServerProvider;

describe("what the model is told about a person's setup", () => {
  it("never carries a key, token, address or account id, whichever field they sit in", () => {
    const setup = buildSetupSnapshot({
      providers: [
        // A display name a person pasted a key into, and a plan label that names an account.
        provider({
          displayName: `Work ${API_KEY}`,
          auth: {
            status: "authenticated",
            type: "chatgpt",
            label: `Plan ${ACCOUNT_ID}`,
            email: EMAIL,
          },
        }),
        provider({ instanceId: "claude", driver: "claudeAgent", displayName: TOKEN }),
      ],
      settings: {
        usageLimitSources: {
          hub: {
            kind: "cliproxy",
            enabled: true,
            url: "https://admin:hunter2@hub.example",
            managementKey: MANAGEMENT_KEY,
          } as never,
          http: { kind: "http", enabled: true } as never,
        },
        textGenerators: {
          openai: {
            kind: "openai",
            enabled: true,
            apiKey: API_KEY,
            baseUrl: "https://api.example/v1",
          } as never,
        },
      },
      resolve: m,
    });

    for (const id of EXPLAIN_TOPIC_IDS) {
      const dispatched = buildHiddenContext(id, setup);
      for (const secret of [
        API_KEY,
        TOKEN,
        MANAGEMENT_KEY,
        EMAIL,
        ACCOUNT_ID,
        "hunter2",
        "api.example",
      ]) {
        expect(dispatched, `${id} leaked ${secret}`).not.toContain(secret);
      }
    }
    // What is allowed through: names and states.
    const context = buildHiddenContext("providers", setup);
    expect(context).toContain("(codex)");
    expect(context).toContain("Ready");
  });

  it("reads only the service and the on or off state of a text generator and the kind of a usage source", () => {
    const setup = buildSetupSnapshot({
      providers: [],
      settings: {
        usageLimitSources: { a: { kind: "cliproxy", enabled: true } as never },
        textGenerators: { g: { kind: "openrouter", enabled: false, apiKey: API_KEY } as never },
      },
      resolve: m,
    });
    expect(setup.usageSources).toEqual([{ kind: "hub", enabled: true }]);
    expect(setup.textGenerators).toEqual([{ service: "openrouter", enabled: false }]);
    expect(JSON.stringify(setup)).not.toContain(API_KEY);
  });

  it("replaces anything shaped like a secret and leaves ordinary names alone", () => {
    expect(withoutSecretShapes(`Work account ${EMAIL}`)).not.toContain(EMAIL);
    expect(withoutSecretShapes("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(withoutSecretShapes("api_key=hello")).not.toContain("hello");
    expect(withoutSecretShapes("Codex")).toBe("Codex");
    expect(withoutSecretShapes("Claude (work)")).toBe("Claude (work)");
  });

  it("replaces the credential after an Authorization scheme, short unprefixed secrets and home directory names", () => {
    for (const [text, leaked] of [
      ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
      ["Authorization: Bearer abc", "abc"],
      ["key 9f86d081884c7d659a2f", "9f86d081884c7d659a2f"],
      ["pw=hunter2", "hunter2"],
      ["pass: hunter2", "hunter2"],
      ["/Users/jasonroell/.codex", "jasonroell"],
      ["/home/alice/.config", "alice"],
      ["C:\\Users\\Alice\\AppData", "Alice"],
    ] as const) {
      expect(withoutSecretShapes(text), text).not.toContain(leaked);
    }
  });

  it("keeps a typed name to plain characters and a short length even when no pattern matches", () => {
    const clean = plainFreeText(`<b>Work</b> "account" {x} = ${"é".repeat(80)}`);
    expect(clean).not.toMatch(/[<>"{}=]/);
    expect(clean.length).toBeLessThanOrEqual(MAX_FREE_TEXT_CHARS);
    expect(plainFreeText("Claude (work) + Codex")).toBe("Claude (work) + Codex");
  });

  it("keeps the words 'app context' and app framing out of every topic's notes and facts", () => {
    const setup = buildSetupSnapshot({
      providers: [provider({ displayName: "Codex" })],
      settings: { usageLimitSources: {}, textGenerators: {} },
      resolve: m,
    });
    for (const id of EXPLAIN_TOPIC_IDS) {
      const topic = explainTopic(id);
      for (const text of [topic.notes, ...topic.facts(setup)]) {
        expect(text, id).not.toMatch(/app context|<app-context/i);
      }
    }
  });
});
