import { describe, expect, it } from "vite-plus/test";

import { standaloneImageCaption } from "./markdownHast.logic";

describe("standaloneImageCaption", () => {
  const image = (properties: Record<string, unknown>) => ({
    type: "element",
    tagName: "img",
    properties,
  });
  const paragraph = (...children: unknown[]) => ({ type: "element", tagName: "p", children });

  it("names the alt text of a paragraph that holds one standalone image", () => {
    expect(
      standaloneImageCaption(
        paragraph({ type: "text", value: "\n" }, image({ dataStandalone: true, alt: " A lens " })),
      ),
    ).toBe("A lens");
  });

  it("names nothing for an image inside a sentence, an image with no alt text, or other content", () => {
    expect(
      standaloneImageCaption(
        paragraph({ type: "text", value: "See " }, image({ dataStandalone: true, alt: "A lens" })),
      ),
    ).toBeNull();
    expect(
      standaloneImageCaption(paragraph(image({ dataStandalone: true, alt: "  " }))),
    ).toBeNull();
    expect(standaloneImageCaption(paragraph(image({ alt: "A lens" })))).toBeNull();
    expect(standaloneImageCaption(paragraph({ type: "text", value: "Words" }))).toBeNull();
  });
});
