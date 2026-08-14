import { execFile } from "node:child_process";
import { readFile, rename, rm, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { rewriteDeclarationImports } from "./rewrite-declaration-imports.ts";

const execute = promisify(execFile);
const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const staging = await mkdtemp(join(root, ".lib-build-"));
const published = join(root, "lib");
const previous = join(root, `.lib-previous-${process.pid}-${Date.now()}`);
const tsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

let movedPrevious = false;
try {
  await execute(tsc, ["-p", join(root, "tsconfig.build.json"), "--outDir", staging], { cwd: root });
  await rewriteDeclarationImports(staging);
  const mathRenderer = join(staging, "math-renderer.js");
  await writeFile(
    mathRenderer,
    (await readFile(mathRenderer, "utf8")).replaceAll(
      /\.\/math-render-worker-(browser|node)\.ts/gu,
      "./math-render-worker-$1.js",
    ),
  );
  await execute(process.execPath, ["--check", join(staging, "xdraw.js")], { cwd: root });

  try {
    await rename(published, previous);
    movedPrevious = true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await rename(staging, published);
  if (movedPrevious) await rm(previous, { force: true, recursive: true });
} catch (error) {
  if (movedPrevious) {
    await rm(published, { force: true, recursive: true });
    await rename(previous, published);
  }
  throw error;
} finally {
  await rm(staging, { force: true, recursive: true });
}
