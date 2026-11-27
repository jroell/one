import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  getComposerSend,
  publishComposerSend,
  retractComposerSend,
  waitForComposerSend,
  type ComposerSendBridge,
} from "./composerSendBridge";

const bridge = (threadKey: string): ComposerSendBridge => ({
  environmentId: EnvironmentId.make("env"),
  threadKey,
  isDraft: false,
  modelSelection: { instanceId: "codex", model: "m" } as ComposerSendBridge["modelSelection"],
  send: async () => ({ ok: true, messageId: threadKey }),
});

it("the side sheet's composer never replaces the main composer's bridge, and each is found by its own scope", async () => {
  publishComposerSend("main-owner", bridge("main-thread"));
  publishComposerSend("sheet-owner", bridge("sheet-thread"), "sheet");

  // The quiz buttons and voice entry read the main bridge: still the main thread.
  expect(getComposerSend()?.threadKey).toBe("main-thread");
  expect(getComposerSend("sheet")?.threadKey).toBe("sheet-thread");
  expect(await waitForComposerSend("main-thread", 50)).not.toBeNull();
  expect(await waitForComposerSend("sheet-thread", 50)).toBeNull();
  expect((await waitForComposerSend("sheet-thread", 50, undefined, "sheet"))?.threadKey).toBe(
    "sheet-thread",
  );

  // The sheet leaving takes only its own bridge, and an old owner cannot retract a newer one.
  retractComposerSend("main-owner", "sheet");
  expect(getComposerSend("sheet")?.threadKey).toBe("sheet-thread");
  retractComposerSend("sheet-owner", "sheet");
  expect(getComposerSend("sheet")).toBeNull();
  expect(getComposerSend()?.threadKey).toBe("main-thread");
  retractComposerSend("main-owner");
  expect(getComposerSend()).toBeNull();
});
