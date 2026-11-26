import { expect, it } from "vite-plus/test";

import { act, render } from "../../test/render";
import { publishChatStatus, useChatStatus, type ChatStatusItem } from "./chatStatus";

const item = (id: string, kind: ChatStatusItem["kind"] = "notice"): ChatStatusItem => ({
  id,
  kind,
  title: id,
  detail: null,
});

function Probe() {
  return (
    <output>
      {useChatStatus()
        .map((entry) => entry.id)
        .join(",")}
    </output>
  );
}

/** Whatever a test published is gone when the test ends. */
function cleared(): Disposable {
  return {
    [Symbol.dispose]: () => {
      publishChatStatus("conversation", []);
      publishChatStatus("sync", []);
    },
  };
}

it("the header's status reads nothing until a source publishes, merges sources, and drops one that clears", async () => {
  using _cleared = cleared();
  await using screen = await render(<Probe />, { router: false });
  const read = () => screen.container.querySelector("output")?.textContent;
  expect(read()).toBe("");
  await act(async () => {
    publishChatStatus("conversation", [item("a")]);
    publishChatStatus("sync", [item("b", "working")]);
  });
  expect(read()).toBe("a,b");
  await act(async () => publishChatStatus("conversation", []));
  expect(read()).toBe("b");
  await act(async () => publishChatStatus("sync", []));
  expect(read()).toBe("");
});
