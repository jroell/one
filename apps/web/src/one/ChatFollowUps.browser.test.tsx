import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { ChatFollowUps } from "./ChatFollowUps";
import { publishComposerSend, retractComposerSend } from "./composerSendBridge";

it("a reply pressed twice quickly is sent once, and the other replies wait with it", async () => {
  // A composer that is slow to accept, so the second press lands while the first is on its way.
  let accept: () => void = () => {};
  const send = vi.fn(
    () =>
      new Promise<{ ok: true; messageId: string }>((resolve) => {
        accept = () => resolve({ ok: true, messageId: "m" });
      }),
  );
  publishComposerSend("test-owner", {
    environmentId: EnvironmentId.make("environment"),
    threadKey: "environment:thread",
    isDraft: false,
    modelSelection: { instanceId: "codex" as never, model: "m" },
    send,
  });
  using _bridge = { [Symbol.dispose]: () => retractComposerSend("test-owner") };
  await using _screen = await render(
    <ChatFollowUps
      ready
      composer={{ current: null }}
      answer={"One account is enough. Usage already shows it.\n\nDo you have a second account?"}
    />,
  );
  await page.getByRole("button", { name: "No", exact: true }).dblClick();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenCalledExactlyOnceWith({ text: "No" });
  expect(page.getByRole("button", { name: "Yes", exact: true }).element()).toBeDisabled();
  accept();
});
