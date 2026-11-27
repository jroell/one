import { assert, describe, it } from "@effect/vitest";
import type { ProviderDriverKind, ProviderReplayTranscript } from "@t3tools/contracts";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import { replayValueMatches, runtimeInfoKey } from "../Adapters/MuseAdapterV2.testkit.ts";
import { materializeReplayTranscriptRuntimeInstructions } from "./ReplayRuntimeInstructions.ts";

const OLD_WORDING =
  "<runtime_info>In case you're asked: you are running in T3 Code through the Muse Code harness, as muse-spark-1.3 with high reasoning effort. No need to mention this otherwise. Some older closing words.</runtime_info>";

describe("replays of runtime instructions recorded before a copy change", () => {
  it("a Muse recording matches the block sent now when harness, model and effort agree, whatever the wording", () => {
    const now = buildRuntimeInstructions({
      harness: "Muse Code",
      model: "muse-spark-1.3",
      reasoningEffort: "high",
    });
    assert.isTrue(
      replayValueMatches({ input: [{ text: OLD_WORDING }] }, { input: [{ text: now }] }),
    );
  });

  it("a Muse recording does not match a block for another model or effort", () => {
    for (const other of [
      buildRuntimeInstructions({
        harness: "Muse Code",
        model: "muse-spark-2",
        reasoningEffort: "high",
      }),
      buildRuntimeInstructions({
        harness: "Muse Code",
        model: "muse-spark-1.3",
        reasoningEffort: "low",
      }),
    ]) {
      assert.isFalse(replayValueMatches({ text: OLD_WORDING }, { text: other }));
    }
    assert.isFalse(replayValueMatches({ text: OLD_WORDING }, { text: "no block here" }));
    assert.isUndefined(runtimeInfoKey("an ordinary prompt"));
  });

  it("an ACP prompt recorded with old wording is expected to carry the current block", () => {
    const runtime = { driver: "kiro" as ProviderDriverKind, model: "auto" };
    const current = buildRuntimeInstructions({ harness: "Kiro", model: "auto" });
    const recorded = {
      entries: [
        {
          type: "expect_outbound",
          label: "prompt",
          frame: {
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
              sessionId: "s1",
              prompt: [
                { type: "text", text: "hello" },
                { type: "text", text: "<runtime_info>an older wording</runtime_info>" },
              ],
            },
          },
        },
      ],
    } as unknown as ProviderReplayTranscript;
    const [entry] = materializeReplayTranscriptRuntimeInstructions(recorded, runtime).entries;
    const frame = (entry as { frame: { params: { prompt: Array<{ text: string }> } } }).frame;
    assert.strictEqual(frame.params.prompt.at(-1)?.text, current);
    assert.strictEqual(frame.params.prompt[0]?.text, "hello");
  });
});
