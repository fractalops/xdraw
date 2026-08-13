import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const execute = promisify(execFile);
const root = resolve(".");

async function filesBelow(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }))).flat();
}

function publicationTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(publicationTargets);
}

test("packed package installs a working xdraw executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-package-"));
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@resvg/resvg-js"], "^2.6.2");
  await execute("npm", ["run", "build"], { cwd: root });
  const packed = JSON.parse((await execute(
    "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], { cwd: root },
  )).stdout)[0];
  const packedPaths = new Set(packed.files.map((file) => file.path));
  assert.ok(packed.files.every((file) => ["LICENSE", "README.md", "package.json", "bin/", "lib/", "examples/", "docs/"]
    .some((prefix) => file.path === prefix || file.path.startsWith(prefix))));
  assert.ok(packed.files.every((file) => !/(?:^|\/)(?:\.env|\.DS_Store)|\.(?:key|log|pem|tmp)$/i.test(file.path)));
  assert.ok(packed.files.some((file) => file.path === "LICENSE"));
  assert.ok(packed.files.some((file) => file.path === "lib/compiler.js"));
  assert.ok(packed.files.some((file) => file.path === "lib/index.d.ts"));
  assert.ok(packed.files.some((file) => file.path === "lib/excalidraw-api.js"));
  assert.ok(packed.files.some((file) => file.path === "lib/excalidraw-api.d.ts"));
  for (const target of [packageJson.main, packageJson.types, ...Object.values(packageJson.bin),
    ...publicationTargets(packageJson.exports)]) {
    assert.ok(packedPaths.has(target.replace(/^\.\//, "")), `published target is missing: ${target}`);
  }
  assert.ok(packed.unpackedSize < 12_000_000, `package is unexpectedly large: ${packed.unpackedSize}`);
  for (const output of await filesBelow(join(root, "lib"))) {
    if (!output.endsWith(".js") && !output.endsWith(".d.ts")) continue;
    const source = await readFile(output, "utf8");
    const specifiers = source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["'](\.\.?\/[^"']+)["']/g);
    for (const [, specifier] of specifiers) {
      assert.match(specifier, /\.js$/, `${output} contains an invalid relative specifier: ${specifier}`);
      const target = resolve(dirname(output), specifier);
      assert.ok(packedPaths.has(relative(root, target)), `${output} imports missing output: ${specifier}`);
    }
  }

  const prefix = join(directory, "installed");
  await execute("npm", [
    "install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund",
    "--install-strategy=nested", join(directory, packed.filename),
  ]);
  const executable = join(prefix, "node_modules", ".bin", "xdraw");
  assert.equal((await execute(executable, ["--version"])).stdout.trim(), `xdraw ${packageJson.version}`);
  await execute(process.execPath, [
    "--input-type=module",
    "--eval",
    "await import('xdraw'); await import('xdraw/excalidraw-api');",
  ], { cwd: prefix });

  const consumer = join(prefix, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "index.ts"), [
    'import { compile } from "xdraw";',
    'import { ExcalidrawApiClient } from "xdraw/excalidraw-api";',
    "void compile;",
    "void ExcalidrawApiClient;",
  ].join("\n"));
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2024",
      typeRoots: [join(root, "node_modules", "@types")],
      types: ["node"],
    },
    include: ["index.ts"],
  }, null, 2));
  await execute(join(root, "node_modules", ".bin", "tsc"), ["-p", join(consumer, "tsconfig.json")], { cwd: consumer });

  const source = join(directory, "installed-example.xdraw");
  await writeFile(source, 'diagram "Installed" { source: rectangle "Source"; target: rectangle "Target"; source -> target }');
  await execute(executable, ["build", source]);
  assert.equal(JSON.parse(await readFile(join(dirname(source), "installed-example.excalidraw"), "utf8")).type, "excalidraw");

  const highlighted = join(directory, "installed-highlighted.xdraw");
  await writeFile(highlighted, 'diagram "Installed" { source: code "const value = 42" { language typescript; highlight true } }');
  await execute(executable, ["build", highlighted]);
  const highlightedDrawing = JSON.parse(await readFile(join(dirname(highlighted), "installed-highlighted.excalidraw"), "utf8"));
  assert.ok(highlightedDrawing.elements.some((element) => element.id.startsWith("source:source:")));
});
