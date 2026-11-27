// @effect-diagnostics nodeBuiltinImport:off - tests use POSIX path joining to match the macOS and Linux layout.
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { resolveDesktopBaseDir, resolveDesktopStateDir } from "./DesktopStatePaths.ts";

describe("DesktopStatePaths", () => {
  const joinPath = NodePath.posix.join;
  const homeDirectory = "/Users/person";

  it("the installed One app keeps its data in ~/.one, apart from an installed T3 Code in ~/.t3", () => {
    const baseDir = resolveDesktopBaseDir({
      homeDirectory,
      isDevelopment: false,
      joinPath,
      t3Home: Option.none(),
    });
    assert.equal(baseDir, "/Users/person/.one");
    assert.equal(
      resolveDesktopStateDir({ baseDir, isDevelopment: false, joinPath, t3Home: Option.none() }),
      "/Users/person/.one/userdata",
    );
  });

  it("the development app keeps its data in ~/.t3/dev", () => {
    const baseDir = resolveDesktopBaseDir({
      homeDirectory,
      isDevelopment: true,
      joinPath,
      t3Home: Option.none(),
    });
    assert.equal(
      resolveDesktopStateDir({ baseDir, isDevelopment: true, joinPath, t3Home: Option.none() }),
      "/Users/person/.t3/dev",
    );
  });

  it("T3CODE_HOME still chooses the data folder for the installed app", () => {
    assert.equal(
      resolveDesktopBaseDir({
        homeDirectory,
        isDevelopment: false,
        joinPath,
        t3Home: Option.some(" /data/one-copy "),
      }),
      "/data/one-copy",
    );
  });
});
