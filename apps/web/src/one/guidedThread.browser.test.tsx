import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { GuidedThreadFooter } from "./GuidedThreadFooter";
import { useGuidedThread } from "./guidedThread";

const KEY = "one:guided-thread";

function stored(value: unknown): Disposable {
  window.sessionStorage.setItem(KEY, JSON.stringify(value));
  return { [Symbol.dispose]: () => window.sessionStorage.removeItem(KEY) };
}

function Shown({ threadKey }: { readonly threadKey: string }) {
  const info = useGuidedThread(threadKey);
  return <output data-info>{info === null ? "none" : JSON.stringify(info)}</output>;
}

it("reads back only what a guided thread entry must be: a malformed entry is dropped or emptied, an outside address is never kept", async () => {
  using _table = stored({
    "no-actions": { asked: "Claude" },
    outside: {
      asked: "Claude",
      actions: [
        { label: "Elsewhere", href: "https://example.net" },
        { label: "Here", href: "/usage" },
        { label: 3, href: "/usage" },
      ],
    },
    "no-name": { actions: [] },
    number: 5,
  });
  const read = async (key: string) => {
    await using screen = await render(<Shown threadKey={key} />);
    return screen.container.querySelector("[data-info]")!.textContent;
  };
  expect(JSON.parse((await read("no-actions"))!)).toEqual({ asked: "Claude", actions: [] });
  expect(JSON.parse((await read("outside"))!)).toEqual({
    asked: "Claude",
    actions: [{ label: "Here", href: "/usage" }],
  });
  expect(await read("no-name")).toBe("none");
  expect(await read("number")).toBe("none");
});

it("the footer opens no address outside the app, even if one reaches it, and does not throw without actions", async () => {
  await using screen = await render(
    <GuidedThreadFooter
      info={
        {
          asked: "Claude",
          actions: [
            { label: "Elsewhere", href: "https://example.net" },
            { label: "javascript", href: "javascript:alert(1)" },
          ],
        } as never
      }
      answered
      timestampFormat="locale"
    />,
  );
  expect(screen.container.querySelector(".one-guided-link")).toBeNull();
  await using bare = await render(
    <GuidedThreadFooter info={{ asked: "Claude" } as never} answered timestampFormat="locale" />,
  );
  expect(bare.container.textContent).toContain("Asked Claude.");
});
