import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { sidebarMarkerId } from "../Sidebar.logic";
import { SidebarSectionHeader } from "./SidebarListMarkers";

const shelf = (count: number, expanded: boolean) => (
  <DndContext>
    <SortableContext items={[sidebarMarkerId("settled-header")]}>
      <ul>
        <SidebarSectionHeader
          marker="settled-header"
          label="Settled"
          count={count}
          toggle={{ expanded, onToggle: () => undefined }}
        />
      </ul>
    </SortableContext>
  </DndContext>
);

it("says an expanded shelf is empty, and stays quiet when collapsed or holding threads", async () => {
  await using screen = await render(shelf(0, true));
  await expect.element(page.getByText("No settled threads.")).toBeVisible();

  await screen.rerender(shelf(0, false));
  expect(page.getByText("No settled threads.").query()).toBeNull();

  await screen.rerender(shelf(3, true));
  expect(page.getByText("No settled threads.").query()).toBeNull();
});
