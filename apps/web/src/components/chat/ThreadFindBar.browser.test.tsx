import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThreadFindBar } from "./ThreadFindBar";

const noop = vi.fn();
const bar = (counting: boolean) => (
  <ThreadFindBar
    open
    query="warning"
    matchCount={22}
    counting={counting}
    status={null}
    onRetry={noop}
    activeIndex={0}
    navigationId={1}
    settled={!counting}
    focusRequestId={0}
    onQueryChange={noop}
    onNext={noop}
    onPrevious={noop}
    onClose={noop}
  />
);

const visibleLabel = () =>
  page.getByRole("search").element().querySelector("[aria-hidden]")?.textContent;

it("spells the match position as '1 of 22', and as a floor while the server is still counting", async () => {
  await using screen = await render(bar(false));
  expect(visibleLabel()).toBe("1 of 22");

  await screen.rerender(bar(true));
  expect(visibleLabel()).toBe("1 of 22+");
});
