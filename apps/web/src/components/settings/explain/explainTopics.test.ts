import { describe, expect, it } from "vite-plus/test";

import { MESSAGE_AGENT_CONTEXT_MAX_CHARS } from "@t3tools/contracts";

import { m } from "../../../i18n/messages";
import { buildHiddenContext } from "./explainConversation";
import { explainDocsUrl, explainTopic, EXPLAIN_TOPIC_IDS } from "./explainTopics";
import { EMPTY_SETUP, type SetupSnapshot } from "./explainTypes";

const ROUTE_TREE = import.meta.glob<string>("../../../routeTree.gen.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const DOCS = import.meta.glob<string>("../../../../../../docs/user/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

describe("explain topics", () => {
  it.each(EXPLAIN_TOPIC_IDS)("%s names a docs page and heading that exist, or none", (id) => {
    const topic = explainTopic(id);
    if (topic.docs === undefined) return;
    const markdown = Object.entries(DOCS).find(([path]) =>
      path.endsWith(`/${topic.docs!.page}`),
    )?.[1];
    expect(markdown, `docs/user/${topic.docs.page} exists`).toBeDefined();
    if (topic.docs.anchor !== undefined) {
      const anchors = [...markdown!.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1]!));
      expect(anchors, `${topic.docs.page}#${topic.docs.anchor}`).toContain(topic.docs.anchor);
    }
    expect(explainDocsUrl(topic)).toContain(topic.docs.page);
  });

  it.each(EXPLAIN_TOPIC_IDS)(
    "%s says what it is, asks a question, and carries reference notes",
    (id) => {
      const topic = explainTopic(id);
      expect(m(topic.title).length).toBeGreaterThan(0);
      expect(m(topic.whatItIs).split(/(?<=[.!?])\s/).length).toBeLessThanOrEqual(3);
      expect(m(topic.question)).toMatch(/\?$/);
      expect(topic.notes.length).toBeGreaterThan(200);
    },
  );

  it.each(EXPLAIN_TOPIC_IDS)(
    "%s answers 'what is this and do I need it' in its first two lines, with no unexplained term",
    (id) => {
      const topic = explainTopic(id);
      expect(topic.verdict, "a verdict line").toBeDefined();
      // The file name t3.json is the topic itself, not the format.
      const firstGlance = `${m(topic.whatItIs)} ${m(topic.verdict!)}`.replaceAll("t3.json", "");
      // Terms that belong in the detail, where each is explained.
      for (const term of [
        /CLIProxyAPI/i,
        /bearer token/i,
        /management key/i,
        /JSON/i,
        /\bAPI\b/,
        /endpoint/i,
        /webhook/i,
        /proxy/i,
      ]) {
        expect(firstGlance, `${id}: ${term}`).not.toMatch(term);
      }
      expect(firstGlance.length).toBeLessThan(330);
    },
  );

  it("describes a hub as CLIProxyAPI and an HTTP source by its JSON format, from the code and docs", () => {
    const hub = explainTopic("usage-hub");
    expect(hub.terms?.map((entry) => m(entry.term))).toContain("CLIProxyAPI");
    expect(hub.notes).toContain("v0/management");
    expect(hub.notes).toContain("Codex, Claude, xAI (shown as Grok) and Antigravity");
    const http = explainTopic("usage-http-source");
    expect(http.notes).toContain('"version":1');
    expect(http.notes).toContain("1 MiB");
  });

  it("puts the hidden notes and setup facts in the model's context, in a stated order", () => {
    const setup: SetupSnapshot = {
      ...EMPTY_SETUP,
      providers: [
        { name: "Codex", driver: "codex", enabled: true, state: "Ready", plan: "ChatGPT Pro" },
      ],
    };
    const context = buildHiddenContext("usage-providers", setup);
    expect(context).toContain("exactly one question per reply");
    expect(context).toContain("another AI account");
    expect(context).toContain("Never invent a feature");
    expect(context).toContain(explainTopic("usage-providers").notes);
    expect(context).toContain("Codex (codex): Ready, plan ChatGPT Pro");
    expect(context).toContain("No usage source (hub or HTTP source) is set up.");
  });

  it("keeps the longest topic with a very large setup well under the limit the server accepts", () => {
    const large: SetupSnapshot = {
      providers: Array.from({ length: 500 }, (_, index) => ({
        name: `Account ${index} ${"x".repeat(150)}`,
        driver: "codex",
        enabled: true,
        state: "Ready",
        plan: "ChatGPT Pro",
      })),
      usageSources: Array.from({ length: 200 }, () => ({ kind: "hub" as const, enabled: true })),
      textGenerators: Array.from({ length: 200 }, () => ({ service: "openai", enabled: true })),
    };
    const longest = Math.max(
      ...EXPLAIN_TOPIC_IDS.map((id) => buildHiddenContext(id, large).length),
    );
    expect(longest).toBeLessThan(MESSAGE_AGENT_CONTEXT_MAX_CHARS * 0.65);
    expect(buildHiddenContext("providers", large)).toContain("more, not listed");
  });

  it("sends every topic's action to a page that exists, with at most three per topic", () => {
    const tree = Object.values(ROUTE_TREE)[0]!;
    const block = tree.slice(tree.indexOf("export interface FileRoutesByFullPath"));
    const routes = new Set(
      [...block.slice(0, block.indexOf("}")).matchAll(/^\s+'(\/[^']*)':/gm)].map(
        (match) => match[1]!,
      ),
    );
    expect(routes.size).toBeGreaterThan(10);
    for (const id of EXPLAIN_TOPIC_IDS) {
      const actions = explainTopic(id).actions ?? [];
      expect(actions.length, `${id} has one to three actions`).toBeGreaterThanOrEqual(1);
      expect(actions.length, id).toBeLessThanOrEqual(3);
      for (const action of actions) {
        const url = new URL(action.href, "http://app.local");
        expect(routes.has(url.pathname), `${id}: ${action.href}`).toBe(true);
        expect(action.href.startsWith("/"), `${id}: ${action.href}`).toBe(true);
        expect(m(action.label).length).toBeGreaterThan(0);
      }
    }
  });
});
