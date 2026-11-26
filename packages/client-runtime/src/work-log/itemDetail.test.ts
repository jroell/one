import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { isJsonToolText, turnItemOutputImages, turnItemOutputText } from "./itemDetail.ts";

describe("isJsonToolText", () => {
  it.each([
    ['{"screenshot":{"mimeType":"image/png"}}', true],
    ['[{"threadId":"thread-1"}]', true],
    ['{\n\n  "status": "completed"\n}', true],
    ['{\n  "count": 1\n}\n\n{\n  "count": 2\n}', true],
    ["false", true],
    ["null", true],
    ["42", true],
    ['"completed"', true],
    ['{"partial":', false],
    ['{"count":1}\n\nFinished.', false],
    ["No output.", false],
    ["", false],
  ] as const)("classifies %j as JSON: %s", (text, expected) => {
    expect(isJsonToolText(text)).toBe(expected);
  });
});

function toolItem(output: unknown): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("images"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-10-01T00:00:00Z"),
    type: "dynamic_tool",
    toolName: "screenshots",
    input: {},
    output,
  };
}

describe("tool image output parsing", () => {
  it.each(["image-only", "summary", "json"] as const)(
    "keeps structured fields beside %s content",
    (shape) => {
      const content = [
        { type: "image", mimeType: "image/png" },
        ...(shape === "image-only"
          ? []
          : [{ type: "text", text: shape === "summary" ? "Sunny" : '{"temp":21}' }]),
      ];
      for (const structuredContent of [
        { temp: 21 },
        { type: "text", text: "Sunny", temp: 21 },
        { content: [{ type: "text", text: "Sunny" }], temp: 21 },
      ]) {
        const item = toolItem({ structuredContent, content });
        expect(turnItemOutputText(item)).toBe(JSON.stringify(structuredContent, null, 2));
        expect(turnItemOutputImages(item)).toHaveLength(1);
      }
      for (const structuredContent of [null, {}, [], ""]) {
        const item = toolItem({ structuredContent, content: [{ type: "text", text: "Sunny" }] });
        expect(turnItemOutputText(item)).toBe("Sunny");
      }
      expect(
        turnItemOutputText(
          toolItem({
            content: [{ type: "text", text: "File contents" }],
            structuredContent: { path: "read.ts", ready: true },
          }),
        ),
      ).toBe("File contents");
    },
  );
  it.each(["array", "content", "structured"] as const)(
    "keeps markers for images beyond the served positions in %s output",
    (shape) => {
      // Detail responses retain image metadata after the server strips image bytes.
      const image = { type: "image", mimeType: "image/png" };
      const blocks = Array.from({ length: 8 }, () => ({ ...image }));
      const wrap = (content: unknown[]) =>
        shape === "array"
          ? content
          : shape === "structured"
            ? { content, structuredContent: { temp: 21 } }
            : { content };
      const withinLimit = toolItem(wrap(blocks));
      expect(turnItemOutputText(withinLimit)).toBe(
        shape === "structured" ? '{\n  "temp": 21\n}' : null,
      );
      expect(turnItemOutputImages(withinLimit)).toHaveLength(8);

      const overflow = toolItem(
        wrap([
          ...blocks,
          { type: "text", text: "Two additional screenshots:" },
          { ...image, sizeBytes: 100 },
          { type: "image", source: { type: "base64", media_type: "image/jpeg" } },
        ]),
      );
      expect(turnItemOutputImages(overflow)).toHaveLength(8);
      expect(turnItemOutputText(overflow)).toBe(
        (shape === "structured" ? '{\n  "temp": 21\n}' : "Two additional screenshots:") +
          "\n[image]\n[image]",
      );
    },
  );
});

describe("tool text output formatting", () => {
  it.each([
    '{"id":1234567890123456789,"name":"x"}',
    '{"id":1}\n{"id":-9007199254740993}',
    '{"id":9.007199254740993e15}',
    '{"id":1e309}',
  ])("keeps %j as returned when parsing would change a number", (text) => {
    expect(turnItemOutputText(toolItem({ content: [{ type: "text", text }] }))).toBe(text);
  });

  it.each(['{"id":42,"note":"12345678901234567890"}', '{"ratio":0.1234567890123456789}'])(
    "still pretty-prints %j",
    (text) => {
      expect(turnItemOutputText(toolItem({ content: [{ type: "text", text }] }))).toBe(
        JSON.stringify(JSON.parse(text), null, 2),
      );
    },
  );
});

describe("MCP app tool output", () => {
  it("shows the tool result, not the app wrapper", () => {
    const text = "Notice\nview\tcount\n/home\t42";
    const item = toolItem({
      t3McpApp: {
        attachmentId: "app-html",
        server: "repro",
        tool: "aggregate_rum_events",
        resourceUri: "ui://repro/dataviz",
      },
      result: { content: [{ type: "text", text }] },
    });
    expect(turnItemOutputText(item)).toBe(text);
  });

  it("reads a result with metadata and marks images it cannot preview", () => {
    const item = toolItem({
      t3McpApp: {
        attachmentId: "app-html",
        server: "repro",
        tool: "chart",
        resourceUri: "ui://repro/chart",
      },
      result: {
        content: [
          { type: "text", text: "chart" },
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        ],
        _meta: { "ui/resourceUri": "ui://repro/chart" },
      },
    });
    expect(turnItemOutputText(item)).toBe("chart\n[image]");

    const bounded = toolItem({
      t3McpApp: {
        attachmentId: "app-html",
        server: "repro",
        tool: "chart",
        resourceUri: "ui://repro/chart",
      },
      result: [
        { type: "text", text: "chart" },
        { type: "image", mimeType: "image/png" },
      ],
    });
    expect(turnItemOutputText(bounded)).toBe("chart\n[image]");
  });
});

describe("file search output text", () => {
  function searchItem(
    results: Extract<OrchestrationV2TurnItem, { type: "file_search" }>["results"],
  ): OrchestrationV2TurnItem {
    const {
      toolName: _toolName,
      input: _input,
      output: _output,
      ...base
    } = toolItem(null) as Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
    return { ...base, type: "file_search", pattern: "needle", results };
  }

  it("prints matches under one heading per file", () => {
    expect(
      turnItemOutputText(
        searchItem([
          { fileName: "src/one.ts", line: 2, preview: "  const needle = 1;" },
          { fileName: "src/two.ts", line: 7, column: 3, preview: "needle()" },
          { fileName: "src/one.ts", line: 9, preview: "return needle;" },
        ]),
      ),
    ).toBe("src/one.ts\n2:   const needle = 1;\n9: return needle;\n\nsrc/two.ts\n7:3: needle()");
  });

  it("keeps a plain file list one path per line", () => {
    expect(turnItemOutputText(searchItem([{ fileName: "a.ts" }, { fileName: "b.ts" }]))).toBe(
      "a.ts\nb.ts",
    );
  });
});

describe("tool results wrapped in content blocks", () => {
  const literal = '{"type":"text","text":""}';

  it("unwraps a typed content block once, with real line breaks", () => {
    const wrapped = [
      { type: "content", content: { type: "text", text: '{\n  "name": "demo"\n}' } },
    ];
    expect(turnItemOutputText(toolItem(wrapped))).toBe('{\n  "name": "demo"\n}');
  });

  it("keeps literal JSON a real text block carries, and does not decode it a second time", () => {
    for (const payload of [literal, '{"type":"text","text":"hello"}']) {
      for (const output of [
        { type: "text", text: payload },
        [{ type: "content", content: { type: "text", text: payload } }],
      ]) {
        const text = turnItemOutputText(toolItem(output));
        expect(JSON.parse(text ?? "")).toEqual(JSON.parse(payload));
      }
    }
  });

  it("unwraps a content block that carries _meta", () => {
    const wrapped = [
      { type: "content", _meta: { source: "tool" }, content: { type: "text", text: "hello" } },
    ];
    expect(turnItemOutputText(toolItem(wrapped))).toBe("hello");
  });

  it("shows each block of a mixed array, with an unknown one as its own JSON", () => {
    const mixed = [
      { type: "content", content: { type: "text", text: "first" } },
      { type: "text", text: "second" },
      { kind: "other", value: 1 },
    ];
    expect(turnItemOutputText(toolItem(mixed))).toBe(
      `first\nsecond\n${JSON.stringify({ kind: "other", value: 1 }, null, 2)}`,
    );
  });

  it("keeps an array of unknown blocks as one JSON value", () => {
    const unknown = [{ kind: "a" }, { kind: "b" }];
    expect(turnItemOutputText(toolItem(unknown))).toBe(JSON.stringify(unknown, null, 2));
  });

  it("reads the text and uri of wrapped resources", () => {
    const text = turnItemOutputText(
      toolItem([
        {
          type: "content",
          content: { type: "resource", resource: { uri: "file:///a", text: "body" } },
        },
        { type: "content", _meta: {}, content: { type: "resource_link", uri: "file:///b" } },
      ]),
    );
    expect(text).toBe("body\nfile:///b");
  });

  it("previews an image inside a wrapper, with or without _meta, instead of printing [image]", () => {
    const image = { type: "image", mimeType: "image/png", data: "AAAA" };
    for (const wrapper of [
      { type: "content", content: image },
      { type: "content", _meta: { n: 1 }, content: image },
    ]) {
      const item = toolItem([wrapper, { type: "text", text: "caption" }]);
      expect(turnItemOutputImages(item)).toHaveLength(1);
      expect(turnItemOutputText(item)).toBe("caption");
    }
  });

  it("keeps structured output beside a wrapped image and wrapped caption", () => {
    const image = { type: "image", mimeType: "image/png", data: "AAAA" };
    const item = toolItem({
      content: [
        { type: "content", content: image },
        { type: "content", content: { type: "text", text: "Caption" } },
      ],
      structuredContent: { accounted: 21 },
    });
    expect(turnItemOutputText(item)).toBe(JSON.stringify({ accounted: 21 }, null, 2));
    expect(turnItemOutputImages(item)).toHaveLength(1);
    const bare = toolItem({
      content: [image, { type: "text", text: "Caption" }],
      structuredContent: { accounted: 21 },
    });
    expect(turnItemOutputText(item)).toBe(turnItemOutputText(bare));
  });

  it("reports no text for a result that really is empty", () => {
    expect(turnItemOutputText(toolItem({ type: "text", text: "" }))).toBeNull();
    expect(
      turnItemOutputText(toolItem([{ type: "content", content: { type: "text", text: "" } }])),
    ).toBeNull();
  });
});
