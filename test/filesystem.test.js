import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MemoryFileSystem, RootedFileSystem } from "../src/filesystem.ts";

test("rooted filesystem reads only relative paths inside its root", async () => {
  const root = await mkdtemp(join(tmpdir(), "xdraw-fs-"));
  await writeFile(join(root, "diagram.xdraw"), 'diagram "Rooted" {}');
  const files = new RootedFileSystem(root);

  assert.equal(await files.readText("diagram.xdraw"), 'diagram "Rooted" {}');
  await assert.rejects(() => files.readText("../outside.xdraw"), /escapes the configured root/);
  await assert.rejects(() => files.readText(join(root, "diagram.xdraw")), /must be relative/);
});

test("memory filesystem follows the same path boundary", async () => {
  const files = new MemoryFileSystem({ "library/node.xdraw": "node" });
  assert.equal(await files.readText("library/node.xdraw"), "node");
  await assert.rejects(() => files.readText("../node.xdraw"), /escapes the configured root/);
  await assert.rejects(() => files.readText("missing.xdraw"), /file not found/);
});

test("rooted filesystem rejects symbolic links that escape its root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "xdraw-symlink-"));
  const root = join(parent, "root");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(root, "link"));

  const files = new RootedFileSystem(root);
  await assert.rejects(() => files.readText("link/secret.txt"), /escapes the configured root through a symbolic link/);
});
