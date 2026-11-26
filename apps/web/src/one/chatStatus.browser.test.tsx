import { expect, it } from "vite-plus/test";

import { act, render } from "../../test/render";
import {
  ChatStatusScopeContext,
  publishChatStatus,
  useChatStatus,
  type ChatStatusItem,
} from "./chatStatus";

const item = (id: string, kind: ChatStatusItem["kind"] = "notice"): ChatStatusItem => ({
  id,
  kind,
  title: id,
  detail: null,
});

function Probe({ scope = "shared" }: { readonly scope?: string }) {
  return (
    <output>
      {useChatStatus(scope)
        .map((entry) => entry.id)
        .join(",")}
    </output>
  );
}

/** Whatever a test published is gone when the test ends. */
function cleared(): Disposable {
  return {
    [Symbol.dispose]: () => {
      for (const scope of ["shared", "main", "side"]) {
        publishChatStatus(scope, "conversation", []);
        publishChatStatus(scope, "sync", []);
      }
    },
  };
}

it("the header's status reads nothing until a source publishes, merges sources, and drops one that clears", async () => {
  using _cleared = cleared();
  await using screen = await render(<Probe />, { router: false });
  const read = () => screen.container.querySelector("output")?.textContent;
  expect(read()).toBe("");
  await act(async () => {
    publishChatStatus("shared", "conversation", [item("a")]);
    publishChatStatus("shared", "sync", [item("b", "working")]);
  });
  expect(read()).toBe("a,b");
  await act(async () => publishChatStatus("shared", "conversation", []));
  expect(read()).toBe("b");
  await act(async () => publishChatStatus("shared", "sync", []));
  expect(read()).toBe("");
});

it("a side chat's status never reaches the main thread's header, and clearing it leaves the main thread's items", async () => {
  using _cleared = cleared();
  await using screen = await render(
    <>
      <ChatStatusScopeContext value="main">
        <Probe scope="main" />
      </ChatStatusScopeContext>
      <ChatStatusScopeContext value="side">
        <Probe scope="side" />
      </ChatStatusScopeContext>
    </>,
    { router: false },
  );
  const [main, side] = [...screen.container.querySelectorAll("output")];
  await act(async () => {
    publishChatStatus("main", "conversation", [item("preparing", "working")]);
    publishChatStatus("side", "conversation", [item("slow-server")]);
  });
  expect(main!.textContent).toBe("preparing");
  expect(side!.textContent).toBe("slow-server");
  // The side chat renders again with nothing to say, and then closes: the main thread still has its item.
  await act(async () => publishChatStatus("side", "conversation", []));
  expect(main!.textContent).toBe("preparing");
  expect(side!.textContent).toBe("");
});
