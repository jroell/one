import { FileIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../test/render";
import { ContextChip, ContextChipLabel } from "./ContextChip";

// An empty inline-block's bottom edge sits on the baseline of the line it is in.
function BaselineMarker(props: { id: string }) {
  return <span data-baseline={props.id} className="inline-block size-0" />;
}

describe("ContextChip", () => {
  it("sets its label on the sentence baseline at the sentence size without growing the line", async () => {
    await using screen = await render(
      <p className="w-[60ch] text-sm leading-relaxed">
        Open
        <BaselineMarker id="text" /> the{" "}
        <ContextChip kind="mention" render={<button type="button" />}>
          <FileIcon />
          <ContextChipLabel>
            src/
            <BaselineMarker id="chip" />
            Typography.tsx
          </ContextChipLabel>
        </ContextChip>{" "}
        file
      </p>,
    );
    const paragraph = screen.container.querySelector("p")!;
    const label = screen.container.querySelector<HTMLElement>('[data-slot="context-chip-label"]')!;
    const baseline = (id: string) =>
      screen.container.querySelector(`[data-baseline="${id}"]`)!.getBoundingClientRect().bottom;

    expect(getComputedStyle(label).fontSize).toBe(getComputedStyle(paragraph).fontSize);
    expect(Math.abs(baseline("chip") - baseline("text"))).toBeLessThanOrEqual(0.5);
    expect(paragraph.getBoundingClientRect().height).toBeCloseTo(
      Number.parseFloat(getComputedStyle(paragraph).lineHeight),
      0,
    );
  });

  it("draws every attachment and context chip label in the one text ink, keeping colour for a pull request's state", async () => {
    const kinds = [
      "file",
      "image",
      "video",
      "doc-pdf",
      "doc-spreadsheet",
      "mention",
      "skill",
      "model",
      "thread",
      "citation",
    ] as const;
    // The theme sets one accent variable per kind at runtime; give each a vivid colour here.
    const accents = Object.fromEntries(
      [...kinds, "pr-merged"].map((kind) => [`--context-chip-${kind}`, "rgb(255 0 0)"]),
    );
    await using screen = await render(
      <p className="text-sm" style={accents}>
        <ContextChip data-kind="plain">
          <ContextChipLabel>plain</ContextChipLabel>
        </ContextChip>
        {kinds.map((kind) => (
          <ContextChip key={kind} kind={kind} data-kind={kind}>
            <ContextChipLabel>{kind}</ContextChipLabel>
          </ContextChip>
        ))}
        <ContextChip kind="pr-merged" data-kind="pr-merged">
          <ContextChipLabel>merged</ContextChipLabel>
        </ContextChip>
      </p>,
    );
    const ink = (kind: string) =>
      getComputedStyle(screen.container.querySelector<HTMLElement>(`[data-kind="${kind}"]`)!).color;
    for (const kind of kinds) expect(ink(kind), kind).toBe(ink("plain"));
    expect(ink("pr-merged")).not.toBe(ink("plain"));
  });
});
