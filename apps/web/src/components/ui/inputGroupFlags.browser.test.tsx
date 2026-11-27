import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";

const group = () => document.querySelector<HTMLElement>('[data-slot="input-group"]')!;
const input = () => group().querySelector<HTMLInputElement>("input")!;

function Fixture({ withEnd }: { readonly withEnd: boolean }) {
  return (
    <InputGroup>
      <InputGroupAddon>@</InputGroupAddon>
      <InputGroupInput aria-label="Handle" />
      {withEnd ? <InputGroupAddon align="inline-end">.com</InputGroupAddon> : null}
    </InputGroup>
  );
}

describe("input group addon flags", () => {
  it("marks the group with each addon side and its control, and clears a side when that addon unmounts", async () => {
    await using screen = await render(<Fixture withEnd />, { router: false });
    expect(group().hasAttribute("data-has-inline-start")).toBe(true);
    expect(group().hasAttribute("data-has-inline-end")).toBe(true);
    expect(group().hasAttribute("data-has-control")).toBe(true);

    await screen.rerender(<Fixture withEnd={false} />);
    expect(group().hasAttribute("data-has-inline-end")).toBe(false);
    expect(group().hasAttribute("data-has-inline-start")).toBe(true);
  });

  it("pads the input only on the sides that have an addon", async () => {
    await using screen = await render(<Fixture withEnd />, { router: false });
    const style = () => getComputedStyle(input());
    const both = [style().paddingInlineStart, style().paddingInlineEnd];
    expect(both).toEqual(["8px", "8px"]);

    await screen.rerender(<Fixture withEnd={false} />);
    expect(style().paddingInlineStart).toBe("8px");
    expect(style().paddingInlineEnd).not.toBe("8px");
  });
});
