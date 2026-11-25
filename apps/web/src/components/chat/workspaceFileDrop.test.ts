import { describe, expect, it } from "@effect/vitest";
import { makeWorkspaceFileDropHandlers, splitTransferredFiles } from "./workspaceFileDrop";

describe("splitTransferredFiles", () => {
  it("separates copied folders from files before attachment validation", () => {
    const folder = new File([], "photos.png");
    const emptyFile = new File([], "empty.txt");
    const image = new File(["image"], "photo.png", { type: "image/png" });

    expect(
      splitTransferredFiles({
        files: [folder, emptyFile, image],
        items: [
          {
            kind: "string",
            getAsFile: () => null,
            webkitGetAsEntry: () => null,
          },
          {
            kind: "file",
            getAsFile: () => folder,
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
          {
            kind: "file",
            getAsFile: () => emptyFile,
            webkitGetAsEntry: () => ({ isDirectory: false }),
          },
          {
            kind: "file",
            getAsFile: () => image,
            webkitGetAsEntry: () => null,
          },
        ],
      }),
    ).toEqual({ files: [emptyFile, image], folders: [folder] });
  });

  it("ignores clipboard file items that cannot provide a file", () => {
    expect(
      splitTransferredFiles({
        files: [],
        items: [
          {
            kind: "file",
            getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
        ],
      }),
    ).toEqual({ files: [], folders: [] });
  });
});

describe("makeWorkspaceFileDropHandlers", () => {
  const leave = (dataTransfer: unknown) => ({
    dataTransfer,
    relatedTarget: null,
    currentTarget: { contains: () => false },
    preventDefault: () => undefined,
  });

  it("ignores a dragleave that carries no data transfer", () => {
    const active: boolean[] = [];
    const handlers = makeWorkspaceFileDropHandlers({
      setDragActive: (value) => active.push(value),
      addFiles: () => undefined,
      addFolders: () => undefined,
    });

    expect(() => handlers.onDragLeave(leave(null) as never)).not.toThrow();
    expect(active).toEqual([]);

    handlers.onDragLeave(leave({ types: ["Files"], files: [], dropEffect: "none" }) as never);
    expect(active).toEqual([false]);
  });
});
