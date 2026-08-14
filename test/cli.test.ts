import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test from "node:test";

import { run } from "../src/cli.ts";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("CLI exposes help and version without Node-specific invocation", async () => {
  assert.match(await run(["--help"]), /^XDraw creates editable Excalidraw diagrams/m);
  assert.equal(await run(["--version"]), `xdraw ${packageJson.version}`);
});

test("CLI exposes nested library help", async () => {
  assert.match(await run(["library"]), /^Inspect XDraw's built-in language libraries/m);
  assert.match(await run(["library", "--help"]), /xdraw library show <canonical-name>/);
  assert.match(await run(["library", "list", "--help"]), /^List XDraw's built-in language libraries/m);
  assert.match(await run(["library", "show", "--help"]), /^Show one built-in language library/m);
  assert.match(await run(["library", "show", "xdraw/core", "--help"]), /^Show one built-in language library/m);
});

test("CLI lists built-in libraries deterministically without remote access", async () => {
  let connections = 0;
  const output = await run(["library", "list"], {
    remoteFactory: async () => {
      connections += 1;
      throw new Error("library inspection must remain local");
    },
  });
  const rows = output.split("\n");
  assert.match(rows[0], /^LIBRARY\s+CONSTRUCTORS\s+VALUES\s+DESCRIPTION$/);
  assert.deepEqual(rows.slice(1).map((row) => row.trim().split(/\s+/u)[0]), [
    "xdraw/annotations",
    "xdraw/architecture",
    "xdraw/assets",
    "xdraw/connectors",
    "xdraw/core",
    "xdraw/math",
    "xdraw/palette",
    "xdraw/process",
    "xdraw/sequence",
    "xdraw/table",
  ]);
  assert.equal(connections, 0);
});

test("CLI shows human-readable and JSON library manifests", async () => {
  const human = await run(["library", "show", "xdraw/sequence"]);
  assert.match(human, /^xdraw\/sequence\nSequence interaction notation\./);
  assert.match(human, /participant \[label: string\]/);
  assert.match(human, /sequence\n\s+Sequence interaction container\./);

  const json = JSON.parse(await run(["library", "show", "xdraw/sequence", "--json"]));
  assert.equal(json.name, "xdraw/sequence");
  assert.deepEqual(json.constructors.map((constructor) => constructor.name), ["participant", "sequence"]);
  assert.equal(json.constructors.find((constructor) => constructor.name === "sequence")
    .children.roles.find((role) => role.name === "participants").minimum, 2);

  const palette = await run(["library", "show", "xdraw/palette"]);
  assert.match(palette, /Values:\n\s+accent: tone - Accent emphasis\./);
  const paletteJson = JSON.parse(await run(["library", "show", "xdraw/palette", "--json"]));
  assert.deepEqual(paletteJson.values.map((value) => value.name), [
    "accent", "danger", "info", "neutral", "success", "warning",
  ]);
});

test("CLI rejects invalid library inspection requests", async () => {
  await assert.rejects(() => run(["library", "show"]), /requires a canonical library name/);
  await assert.rejects(() => run(["library", "show", "sequence"]), /unknown library 'sequence'/);
  await assert.rejects(() => run(["library", "show", "xdraw/missing"]), /xdraw library list/);
  await assert.rejects(() => run(["library", "list", "extra"]), /unexpected argument: extra/);
  await assert.rejects(() => run(["library", "inspect"]), /unknown library command 'inspect'/);
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

test("CLI renders transparent logo previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-transparent-preview-"));
  const svgPath = join(directory, "logo.svg");
  await run([
    "build", "-e", 'diagram "" { mark: ellipse "" }',
    "-o", svgPath, "--background", "transparent",
  ]);
  assert.doesNotMatch(await readFile(svgPath, "utf8"), /<rect width="100%" height="100%"/);
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
  await assert.rejects(() => run(["pull", "scene-1", "--max-width", "1921"]), /no greater than 1920/);
  await assert.rejects(() => run(["pull", "scene-1", "--frame", "main", "-o", "scene.excalidraw"]), /require a .png or .svg output/);
  await assert.rejects(
    () => run(["build", "-e", 'diagram "" {}', "--background", "transparent"]),
    /requires a .png or .svg output/,
  );
  await assert.rejects(() => run(["pull", "scene-1", "-o", "scene.jpeg"]), /must end in/);
  await assert.rejects(() => run(["inspect", "scene-1"]), /unknown command 'inspect'/);
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
    async listScenes() {
      return [{
        address: "excalidraw::default::Architecture::System overview",
        sceneId: "scene-1",
        sceneName: "System overview",
        collectionId: "collection-1",
        collectionName: "Architecture",
      }];
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
  }), "Created excalidraw::default::architecture::system_overview (3 elements)\nScene ID: scene-new");
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

test("CLI lists copyable hosted-scene addresses", async () => {
  let collection;
  const remote = fakeRemote({
    async listScenes(selector) {
      collection = selector;
      return fakeRemote().listScenes();
    },
  });
  const result = await run(["list", "Architecture"], { remoteFactory: async () => remote });
  assert.equal(collection, "Architecture");
  assert.match(result, /^ADDRESS\s+SCENE ID/m);
  assert.match(result, /excalidraw::default::Architecture::System overview\s+scene-1/);
});

test("CLI accepts inline long-option values", async () => {
  let options;
  await run(["list", "--api-url=https://example.test/api/v1"], {
    remoteFactory: async (value) => {
      options = value;
      return fakeRemote();
    },
  });
  assert.deepEqual(options, { baseUrl: "https://example.test/api/v1" });
});

test("CLI pulls scene addresses as editable JSON, PNG, or SVG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xdraw-remote-"));
  const scene = join(directory, "scene.excalidraw");
  const png = join(directory, "scene.png");
  const svg = join(directory, "scene.svg");
  const address = "excalidraw::default::Architecture::System overview";
  let pulled;
  const remote = fakeRemote({ async pull(target) { pulled = target; return fakeRemote().pull(); } });
  assert.match(await run(["pull", address, "-o", scene], { remoteFactory: async () => remote }), /Saved excalidraw::/);
  assert.deepEqual(pulled, {
    provider: "excalidraw", workspace: "default", collection: "Architecture", scene: "System overview",
  });
  assert.equal(JSON.parse(await readFile(scene, "utf8")).type, "excalidraw");
  await run(["pull", "scene-1", "-o", png, "--max-width", "800"], { remoteFactory: async () => fakeRemote() });
  await run(["pull", "scene-1", "-o", svg], { remoteFactory: async () => fakeRemote() });
  assert.deepEqual([...(await readFile(png)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(await readFile(svg, "utf8"), /^<svg /);
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
  }), "Patched excalidraw::default::architecture::system_overview (1 added, 1 updated, 1 deleted)\nScene ID: scene-existing");
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
  await assert.rejects(
    () => run(["pull", "bad::address"], { remoteFactory }),
    /provider::workspace::collection::scene/,
  );
  assert.equal(connections, 0);
});
