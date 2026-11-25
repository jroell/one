interface WorkspaceFileTransfer {
  readonly types: ReadonlyArray<string>;
  readonly files: Iterable<File>;
  readonly items?: Iterable<{
    readonly kind: string;
    getAsFile(): File | null;
    webkitGetAsEntry(): { readonly isDirectory: boolean } | null;
  }>;
  dropEffect: string;
}

interface WorkspaceFileDragEvent {
  /** A dragleave can carry no transfer, although React types it as always present. */
  readonly dataTransfer: WorkspaceFileTransfer | null;
  readonly relatedTarget: EventTarget | null;
  readonly currentTarget: {
    contains(target: Node | null): boolean;
  };
  preventDefault(): void;
}

interface WorkspaceFileDropHost {
  setDragActive(active: boolean): void;
  addFiles(files: File[]): void;
  addFolders(folders: File[]): void;
}

function fileTransferOf(event: WorkspaceFileDragEvent): WorkspaceFileTransfer | null {
  return event.dataTransfer?.types.includes("Files") === true ? event.dataTransfer : null;
}

function movedWithinDropTarget(event: WorkspaceFileDragEvent): boolean {
  return event.relatedTarget !== null && event.currentTarget.contains(event.relatedTarget as Node);
}

export function splitTransferredFiles(
  dataTransfer: Pick<WorkspaceFileTransfer, "files" | "items">,
): {
  files: File[];
  folders: File[];
} {
  if (dataTransfer.items === undefined)
    return { files: Array.from(dataTransfer.files), folders: [] };

  const files: File[] = [];
  const folders: File[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null) continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) {
      folders.push(file);
    } else {
      files.push(file);
    }
  }
  return { files, folders };
}

export function makeWorkspaceFileDropHandlers(host: WorkspaceFileDropHost) {
  return {
    onDragEnter(event: WorkspaceFileDragEvent) {
      if (fileTransferOf(event) === null) return;
      event.preventDefault();
      if (movedWithinDropTarget(event)) return;
      host.setDragActive(true);
    },
    onDragOver(event: WorkspaceFileDragEvent) {
      const transfer = fileTransferOf(event);
      if (transfer === null) return;
      event.preventDefault();
      transfer.dropEffect = "copy";
      host.setDragActive(true);
    },
    onDragLeave(event: WorkspaceFileDragEvent) {
      if (fileTransferOf(event) === null) return;
      event.preventDefault();
      if (movedWithinDropTarget(event)) return;
      host.setDragActive(false);
    },
    onDrop(event: WorkspaceFileDragEvent) {
      const transfer = fileTransferOf(event);
      if (transfer === null) return;
      event.preventDefault();
      host.setDragActive(false);
      const { files, folders } = splitTransferredFiles(transfer);
      if (files.length > 0) host.addFiles(files);
      if (folders.length > 0) host.addFolders(folders);
    },
  };
}
