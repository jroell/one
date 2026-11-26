import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { useStableArray } from "./useStableArray";

const seen: ReadonlyArray<string>[] = [];

function Probe(props: { ids: ReadonlyArray<string> }) {
  seen.push(useStableArray(props.ids));
  return <output>{props.ids.join(",")}</output>;
}

it("useStableArray keeps one array while the ids are the same and swaps it when one changes", async () => {
  seen.length = 0;
  await using screen = await render(<Probe ids={["a", "b"]} />, {
    // A bare hook probe; nothing here navigates.
    router: false,
  });
  await screen.rerender(<Probe ids={["a", "b"]} />);
  const first = seen[0];
  expect(seen.at(-1), "a new array with the same ids").toBe(first);

  await screen.rerender(<Probe ids={["a", "c"]} />);
  expect(seen.at(-1), "an array with a changed id").not.toBe(first);
  expect(seen.at(-1)).toEqual(["a", "c"]);
});
