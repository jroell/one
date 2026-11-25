import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { V2ItemInspector } from "./V2ItemInspector";

function projected(fields: Record<string, unknown>) {
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: "thread-1",
    sourceItemId: "item-1",
    item: {
      id: "item-1",
      threadId: "thread-1",
      runId: "run-1",
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: {},
      ...fields,
    },
  } as never;
}

async function renderInspector(fields: Record<string, unknown>) {
  return render(
    <V2ItemInspector
      projectedItem={projected(fields)}
      environmentId={EnvironmentId.make("environment-local")}
    />,
    { router: false },
  );
}

const LITERAL = '{"type":"text","text":"hello"}';

it("shows a command's printed JSON exactly, even when it has the shape of a content block", async () => {
  await using screen = await renderInspector({
    type: "command_execution",
    input: `printf '%s' '${LITERAL}'`,
    output: LITERAL,
    exitCode: 0,
  });
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector("[data-one-output]")?.textContent?.replace(/\s/g, ""),
    ).toBe(LITERAL.replace(/\s/g, "")),
  );
});

it("shows a command that prints an empty text block as that text, not as no output", async () => {
  await using screen = await renderInspector({
    type: "command_execution",
    input: "echo",
    output: '{"type":"text","text":""}',
    exitCode: 0,
  });
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-one-output]")?.textContent).toContain('"text"'),
  );
  expect(screen.container.textContent).not.toContain("No output.");
});

it("decodes the same text when a dynamic tool returned it as typed content", async () => {
  await using screen = await renderInspector({
    type: "dynamic_tool",
    toolName: "read_file",
    input: { path: "/repo/a.txt" },
    output: LITERAL,
  });
  await expect.element(screen.getByText("hello", { exact: true })).toBeVisible();
  expect(screen.container.textContent).not.toContain('"type"');
});

it("says there was no output when typed content decodes to empty text", async () => {
  await using screen = await renderInspector({
    type: "dynamic_tool",
    toolName: "read_file",
    input: { path: "/repo/a.txt" },
    output: '{"type":"text","text":""}',
  });
  await expect.element(screen.getByText("No output.")).toBeVisible();
});
