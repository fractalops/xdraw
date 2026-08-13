import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test from "node:test";

import { run } from "../src/cli.js";

test("CLI exposes help and version without Node-specific invocation", async () => {
  assert.match(await run(["--help"]), /^XDraw creates editable Excalidraw diagrams/m);
  assert.equal(await run(["--version"]), "xdraw 0.1.0");
});

test("CLI checks source and chooses a neighboring output by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-cli-"));
  const input = join(directory, "hello.xdraw");
  await writeFile(input, 'diagram "Hello" { a: rectangle "A"; b: rectangle "B"; a -> b }');
  assert.equal(await run(["check", input]), `OK ${input}`);
  assert.equal(await run(["build", input]), `Created ${join(directory, "hello.excalidraw")}`);
  assert.equal(JSON.parse(await readFile(join(directory, "hello.excalidraw"), "utf8")).type, "excalidraw");
});

test("CLI emits Excalidraw JSON on standard output", async () => {
  const output = await run(["build", "--expression", 'diagram "Hello" { a: rectangle "A" }', "--output", "-"]);
  assert.equal(JSON.parse(output).type, "excalidraw");
});

test("CLI reads redirected or piped source without requiring a dash", async () => {
  const source = 'diagram "Flow" { a: rectangle "Source"; b: rectangle "Target"; a -> b }';
  const implicit = await run(["build"], { stdin: Readable.from([source]) });
  const explicit = await run(["build", "-"], { stdin: Readable.from([source]) });
  assert.equal(JSON.parse(implicit).type, "excalidraw");
  assert.deepEqual(JSON.parse(implicit), JSON.parse(explicit));
  assert.equal(await run(["check"], { stdin: Readable.from([source]) }), "OK stdin");
});

test("CLI writes piped source to an explicit output path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-stdin-"));
  const output = join(directory, "piped.excalidraw");
  const result = await run(["build", "--output", output], {
    stdin: Readable.from(['diagram "Piped" { a: rectangle "Piped" }']),
  });
  assert.equal(result, `Created ${output}`);
  assert.equal(JSON.parse(await readFile(output, "utf8")).type, "excalidraw");
});

test("CLI renders local PNG and SVG previews from the build command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-preview-"));
  const source = 'diagram "Preview" { a: rectangle "A" }';
  const pngPath = join(directory, "preview.png");
  const svgPath = join(directory, "preview.svg");
  await run(["build", "-e", source, "-o", pngPath]);
  await run(["build", "-e", source, "-o", svgPath]);
  const png = await readFile(pngPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(await readFile(svgPath, "utf8"), /^<svg /);
});

test("CLI shows help instead of waiting for interactive stdin", async () => {
  const stdin = Readable.from([]);
  stdin.isTTY = true;
  assert.match(await run(["build"], { stdin }), /^XDraw creates editable Excalidraw diagrams/m);
});

test("CLI rejects incomplete or conflicting options", async () => {
  await assert.rejects(() => run(["build", "-e"]), /--expression requires source/);
  await assert.rejects(() => run(["check", "a.xdraw", "-o", "out"]), /check does not create output/);
  await assert.rejects(() => run(["build", "a.xdraw", "-e", "a: card \"A\""]), /either a file\/stdin or --expression/);
  await assert.rejects(() => run(["build", "a.xdraw", "--api-url", "https://example.test/api/v1"]), /build does not accept --api-url/);
  await assert.rejects(() => run(["inspect", "scene-1", "--max-width", "1921"]), /no greater than 1920/);
  await assert.rejects(() => run(["push", "a.xdraw"]), /unknown command 'push'/);
  await assert.rejects(() => run(["patch", "scene-1"]), /unknown command 'patch'/);
  await assert.rejects(() => run(["serve"]), /unknown command 'serve'/);
});

function fakeRemote(overrides = {}) {
  return {
    closed: false,
    async close() { this.closed = true; },
    async applyReplace() { return { sceneId: "scene-new", added: 3, created: true }; },
    async applyPatch(_resource, patch) {
      return {
        sceneId: "scene-existing",
        added: patch.drawing ? 1 : 0,
        updated: patch.updates?.length ?? 0,
        deleted: patch.deletes?.length ?? 0,
      };
    },
    async pull() {
      return {
        type: "excalidraw",
        version: 2,
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
        elements: [{
          id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 60,
          strokeColor: "#1f2937", backgroundColor: "#dbeafe", strokeWidth: 2, opacity: 100,
        }],
      };
    },
    ...overrides,
  };
}

test("CLI applies source-authoritative scene replacement", async () => {
  const created = fakeRemote();
  assert.equal(await run(["apply", "-e", `
    scene excalidraw::default::architecture::system_overview {
      replace { diagram "System overview" { a: rectangle "A" } }
    }
  `], {
    remoteFactory: async () => created,
  }), "Created excalidraw::default::architecture::system_overview (3 elements)");
  assert.equal(created.closed, true);
});

test("CLI resolves assets inside replacement scene documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-scene-assets-"));
  await writeFile(join(directory, "mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
  const input = join(directory, "architecture.scene.xdraw");
  await writeFile(input, `
    scene excalidraw::default::architecture::system_overview {
      replace {
        diagram "Assets" {
          mark: asset "mark.svg"
          logo: image(mark) { at (80, 80); size (40, 20) }
        }
      }
    }
  `);
  assert.match(await run(["apply", input], {
    remoteFactory: async () => fakeRemote(),
  }), /^Created excalidraw::default::architecture::system_overview/);
});

test("CLI pulls scene JSON and saves screenshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-remote-"));
  const scene = join(directory, "scene.excalidraw");
  const screenshot = join(directory, "scene.png");
  assert.match(await run(["pull", "scene-1", "-o", scene], {
    remoteFactory: async () => fakeRemote(),
  }), /Downloaded scene scene-1/);
  assert.equal(JSON.parse(await readFile(scene, "utf8")).type, "excalidraw");
  assert.match(await run(["inspect", "scene-1", "-o", screenshot], {
    remoteFactory: async () => fakeRemote(),
  }), /Saved scene scene-1 preview/);
  const png = await readFile(screenshot);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("CLI applies selective patches from XDraw source", async () => {
  const source = `
    scene excalidraw::default::architecture::system_overview {
      patch {
        update api { tone warning }
        delete obsolete
        add { review: rectangle "Requires review" { at (80, 80) } }
      }
    }
  `;
  assert.equal(await run(["apply"], {
    stdin: Readable.from([source]),
    remoteFactory: async () => fakeRemote(),
  }), "Patched excalidraw::default::architecture::system_overview (1 added, 1 updated, 1 deleted)");
});

test("CLI rejects malformed scene documents before connecting", async () => {
  let connections = 0;
  const remoteFactory = async () => { connections += 1; return fakeRemote(); };
  await assert.rejects(
    () => run(["apply"], { stdin: Readable.from(["not a scene"]), remoteFactory }),
    /expected 'scene'/,
  );
  await assert.rejects(
    () => run(["apply"], {
      stdin: Readable.from(["scene excalidraw::default::main::one { patch {} }"]),
      remoteFactory,
    }),
    /must add, update, or delete/,
  );
  assert.equal(connections, 0);
});
