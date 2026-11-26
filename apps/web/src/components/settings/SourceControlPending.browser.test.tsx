import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { SourceControlPendingSection } from "./SourceControlSettings";

describe("source control while the server scans", () => {
  it("names each tool and marks it with one quiet dot after 250 ms, never a column of Checking text", async () => {
    await using screen = await render(
      <div data-app-modal="" className="w-[720px]">
        <SourceControlPendingSection
          title="Version control"
          items={[
            { key: "git", label: "Git", icon: <span /> },
            { key: "jj", label: "Jujutsu", icon: <span /> },
          ]}
        />
      </div>,
      { router: "/settings/source-control" },
    );
    const text = screen.container.textContent ?? "";
    expect(text).toContain("Git");
    expect(text).toContain("Jujutsu");
    // Spoken, not drawn.
    const marks = [...screen.container.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(getComputedStyle(mark).animationDelay).toBe("0.25s");
      expect(getComputedStyle(mark).opacity).toBe("0");
      expect(mark.querySelector(".sr-only")?.textContent).toBe("Checking");
      expect(mark.querySelector("svg")).toBeNull();
    }
  });
});
