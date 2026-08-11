import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const execute = promisify(execFile);
const root = resolve(".");

test("packed package installs a working xdraw executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-package-"));
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@resvg/resvg-js"], "^2.6.2");
  await execute("npm", ["run", "build"], { cwd: root });
  const packed = JSON.parse((await execute(
    "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], { cwd: root },
  )).stdout)[0];
  assert.ok(packed.files.every((file) => ["LICENSE", "README.md", "package.json", "bin/", "src/", "examples/", "docs/language-reference.md"]
    .some((prefix) => file.path === prefix || file.path.startsWith(prefix))));
  assert.ok(packed.files.some((file) => file.path === "LICENSE"));
  assert.ok(packed.files.some((file) => file.path === "src/compiler.js"));
  assert.ok(packed.unpackedSize < 12_000_000, `package is unexpectedly large: ${packed.unpackedSize}`);

  const prefix = join(directory, "installed");
  await execute("npm", [
    "install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed.filename),
  ]);
  const executable = join(prefix, "node_modules", ".bin", "xdraw");
  assert.equal((await execute(executable, ["--version"])).stdout.trim(), "xdraw 0.1.0");

  const source = join(directory, "installed-example.xdraw");
  await writeFile(source, 'source: card "Source"; target: card "Target"; source -> target');
  await execute(executable, ["build", source]);
  assert.equal(JSON.parse(await readFile(join(dirname(source), "installed-example.excalidraw"), "utf8")).type, "excalidraw");
});
