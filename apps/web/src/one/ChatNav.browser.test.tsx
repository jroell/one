import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../test/render";
import { ChatNav } from "./ChatNav";

function nav() {
  return (
    <ChatNav
      items={[{ id: "a", rowIndex: 0, userText: "What is a hub?", assistantText: "A hub is ..." }]}
      currentId="a"
      threadKey="environment:thread"
      onSelect={() => {}}
      sections={new Map()}
      onSelectSection={() => {}}
      onWheel={() => {}}
      onShownChange={() => {}}
      progressRef={() => {}}
    >
      {null}
    </ChatNav>
  );
}

/** Counts the layout reads made on the nav host: size reads and rect reads force a layout when styles are dirty. */
function countHostLayoutReads(): { readonly count: () => number } & Disposable {
  let reads = 0;
  const isHost = (element: Element) => element.classList.contains("one-chat-nav");
  const sizeGetter = (prototype: Element | HTMLElement, property: string) => {
    const get = Object.getOwnPropertyDescriptor(prototype, property)!.get!;
    return vi.spyOn(prototype, property as never, "get" as never).mockImplementation(function (
      this: Element,
    ) {
      if (isHost(this)) reads += 1;
      return get.call(this);
    } as never);
  };
  const spies = [
    sizeGetter(Element.prototype, "clientWidth"),
    sizeGetter(Element.prototype, "clientHeight"),
    sizeGetter(HTMLElement.prototype, "offsetWidth"),
    sizeGetter(HTMLElement.prototype, "offsetHeight"),
  ];
  const original = Element.prototype.getBoundingClientRect;
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (isHost(this)) reads += 1;
    return original.call(this);
  });
  return {
    count: () => reads,
    [Symbol.dispose]() {
      for (const spy of spies) spy.mockRestore();
      rect.mockRestore();
    },
  };
}

it("the outline rail sizes itself from the resize observer and never reads layout while it mounts", async () => {
  using reads = countHostLayoutReads();
  const container = document.createElement("div");
  container.style.cssText = "position: relative; width: 1440px; height: 900px";
  await using wide = await render(nav(), { container });
  // It still finds room and shows the outline, from the observer's own size.
  await vi.waitFor(() => expect(wide.container.querySelector(".one-chat-outline")).not.toBeNull());
  expect(reads.count()).toBe(0);

  const narrow = document.createElement("div");
  narrow.style.cssText = "position: relative; width: 600px; height: 900px";
  await using small = await render(nav(), { container: narrow });
  await vi.waitFor(() => expect(small.container.querySelector(".one-chat-nav")).not.toBeNull());
  expect(small.container.querySelector(".one-chat-outline")).toBeNull();
  expect(reads.count()).toBe(0);
});
