import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssets } from "../src/io/assets.ts";
import { compileAsync } from "../src/compile/pipeline.ts";
import { MemoryFileSystem } from "../src/io/filesystem.ts";
import { LibraryManifestError } from "../src/language/manifests/contracts.ts";
import { defineLibraryManifest, manifestForIntrospection, normalizeLibraryCatalog, summarizeLibraryManifest } from "../src/language/manifests/schema.ts";
import { CORE_LIBRARY_MANIFEST, STANDARD_LIBRARY_MANIFESTS } from "../src/language/manifests/builtins.ts";
import { parseSource } from "../src/language/parser.ts";

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "xdraw/example",
    documentation: {
      synopsis: "Example library.",
      examples: ["use \"xdraw/example\" as example"],
    },
    values: [],
    constructors: [{
      name: "step",
      identity: "named",
      arguments: [{
        name: "label",
        kind: "string",
        required: false,
        variadic: false,
        synopsis: "Visible label.",
      }],
      properties: [{
        name: "tone",
        kind: "identifier",
        required: false,
        synopsis: "Visual tone.",
      }],
      children: {
        mode: "roles",
        roles: [{
          name: "content",
          accepts: ["node", "text"],
          minimum: 0,
          maximum: null,
          synopsis: "Nested content.",
        }],
      },
      defaults: {
        properties: { tone: "neutral" },
      },
      lowering: {
        semanticKind: "node",
        elementKind: "card",
        tone: null,
      },
      documentation: {
        synopsis: "Process step.",
        examples: ["item: example.step \"Review\""],
      },
    }],
  };
}

function cloneManifest(): Record<string, unknown> {
  return structuredClone(validManifest());
}

test("normalizes manifests into immutable, deterministic introspection data", () => {
  const input = cloneManifest();
  const constructors = input.constructors as Record<string, unknown>[];
  const properties = constructors[0].properties as Record<string, unknown>[];
  properties.push({
    name: "background",
    kind: "string",
    required: false,
    synopsis: "Background color.",
  });

  const normalized = manifestForIntrospection(input);
  assert.deepEqual(normalized.constructors[0].properties.map(({ name }) => name), ["background", "tone"]);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.constructors[0].properties), true);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), normalized);
});

test("publishes the intended constructor vocabulary", () => {
  const core = new Set(CORE_LIBRARY_MANIFEST.constructors.map(({ name }) => name));
  assert.ok(core.has("template"));
  assert.ok(core.has("section"));
  assert.equal(core.has("component"), false);

  const libraries = new Map(STANDARD_LIBRARY_MANIFESTS.map((manifest) => [manifest.name, manifest]));
  assert.equal(libraries.has("xdraw/cards"), false);
  assert.equal(libraries.has("xdraw/containers"), false);
  assert.deepEqual(
    libraries.get("xdraw/sequence")?.constructors.map(({ name }) => name),
    ["participant", "sequence"],
  );
  assert.deepEqual(
    libraries.get("xdraw/table")?.constructors.map(({ name, identity }) => ({ name, identity })),
    [
      { name: "header", identity: "anonymous" },
      { name: "row", identity: "anonymous" },
      { name: "table", identity: "named" },
    ],
  );
  assert.deepEqual(
    libraries.get("xdraw/math")?.constructors.map(({ name, identity }) => ({ name, identity })),
    [{ name: "formula", identity: "named" }, { name: "plot", identity: "named" }],
  );
  assert.deepEqual(
    libraries.get("xdraw/palette")?.values.map(({ name }) => name),
    ["accent", "danger", "info", "neutral", "success", "warning"],
  );
});

test("publishes runnable constructor examples", async () => {
  for (const manifest of [CORE_LIBRARY_MANIFEST, ...STANDARD_LIBRARY_MANIFESTS]) {
    const importStatement = manifest.name === "xdraw/core" ? "" : manifest.documentation.examples[0];
    for (const constructor of manifest.constructors) {
      for (const example of constructor.documentation.examples) {
        const asset = ["icon", "image"].includes(constructor.lowering.semanticKind)
          ? 'logo: asset "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E"'
          : "";
        const source = `${importStatement}\ndiagram "Example" {\n${asset}\n${example}\n}`;
        await assert.doesNotReject(
          async () => (await compileAsync(await resolveAssets(parseSource(source), new MemoryFileSystem()))).toJSON(),
          `${manifest.name}.${constructor.name}: ${example}`,
        );
      }
    }
  }
});

test("keeps specialized rendering explicit in semantic element kinds", () => {
  const architecture = STANDARD_LIBRARY_MANIFESTS.find(({ name }) => name === "xdraw/architecture");
  assert.ok(architecture);
  assert.ok(architecture.constructors.length > 0);
  assert.ok(architecture.constructors.every(({ lowering }) => lowering.semanticKind === "node" || lowering.semanticKind === "frame"));
  assert.ok(architecture.constructors.every(({ lowering }) => lowering.elementKind?.startsWith("architecture-")));
  assert.equal(JSON.stringify(architecture).includes("function"), false);
});

test("summaries are stable and suitable for library list JSON", () => {
  const architecture = STANDARD_LIBRARY_MANIFESTS.find(({ name }) => name === "xdraw/architecture");
  assert.ok(architecture);
  assert.deepEqual(summarizeLibraryManifest(architecture), {
    name: "xdraw/architecture",
    synopsis: "Software architecture notation.",
    constructors: [
      "component",
      "container",
      "container-boundary",
      "database",
      "deployment-node",
      "external-system",
      "group",
      "person",
      "queue",
      "system",
      "system-boundary",
    ],
    values: [],
  });
});

test("rejects unknown fields rather than silently ignoring them", () => {
  const input = cloneManifest();
  input.runtime = () => undefined;
  assert.throws(
    () => defineLibraryManifest(input),
    (error: unknown) => error instanceof LibraryManifestError
      && error.message === "manifest: contains unknown field(s): runtime",
  );
});

test("rejects duplicate libraries, exports, properties and child roles", () => {
  const duplicateLibrary = cloneManifest();
  assert.throws(() => normalizeLibraryCatalog([validManifest(), duplicateLibrary]), /duplicate library 'xdraw\/example'/);

  const duplicateConstructor = cloneManifest();
  const constructors = duplicateConstructor.constructors as unknown[];
  constructors.push(structuredClone(constructors[0]));
  assert.throws(() => defineLibraryManifest(duplicateConstructor), /duplicate name 'step'/);

  const duplicateValue = cloneManifest();
  const values = duplicateValue.values as unknown[];
  values.push(
    { name: "success", kind: "tone", synopsis: "Success." },
    { name: "success", kind: "tone", synopsis: "Also success." },
  );
  assert.throws(() => defineLibraryManifest(duplicateValue), /duplicate name 'success'/);

  const collidingValue = cloneManifest();
  (collidingValue.values as unknown[]).push({ name: "step", kind: "tone", synopsis: "Collision." });
  assert.throws(() => defineLibraryManifest(collidingValue), /exports 'step' as both a constructor and a value/);

  const duplicateProperty = cloneManifest();
  const constructor = (duplicateProperty.constructors as Record<string, unknown>[])[0];
  const properties = constructor.properties as unknown[];
  properties.push(structuredClone(properties[0]));
  assert.throws(() => defineLibraryManifest(duplicateProperty), /duplicate name 'tone'/);

  const duplicateRole = cloneManifest();
  const children = ((duplicateRole.constructors as Record<string, unknown>[])[0].children) as Record<string, unknown>;
  const roles = children.roles as unknown[];
  roles.push(structuredClone(roles[0]));
  assert.throws(() => defineLibraryManifest(duplicateRole), /duplicate name 'content'/);
});

test("rejects ambiguous signatures and incompatible defaults", () => {
  const badOrder = cloneManifest();
  const constructor = (badOrder.constructors as Record<string, unknown>[])[0];
  const argumentsList = constructor.arguments as unknown[];
  argumentsList.push({
    name: "required-after-optional",
    kind: "string",
    required: true,
    variadic: false,
    synopsis: "Invalid ordering.",
  });
  assert.throws(() => defineLibraryManifest(badOrder), /required argument cannot follow an optional argument/);

  const unknownDefault = cloneManifest();
  const defaults = ((unknownDefault.constructors as Record<string, unknown>[])[0].defaults) as Record<string, unknown>;
  (defaults.properties as Record<string, unknown>).missing = true;
  assert.throws(() => defineLibraryManifest(unknownDefault), /does not name a declared property/);

  const wrongDefaultType = cloneManifest();
  const wrongDefaults = ((wrongDefaultType.constructors as Record<string, unknown>[])[0].defaults) as Record<string, unknown>;
  (wrongDefaults.properties as Record<string, unknown>).tone = 42;
  assert.throws(() => defineLibraryManifest(wrongDefaultType), /must match kind 'identifier'/);
});

test("rejects lowering values outside the compiler contract", () => {
  const cases = [
    [
      "semanticKind",
      "widget",
      "must be one of asset, code, frame, freedraw, group, icon, image, lane, node, note, participant, plot, section, sequence, table-header, table-row, style, template, text, theme",
    ],
    [
      "elementKind",
      "hexagon",
      "must be one of architecture-component, architecture-container, architecture-container-boundary, architecture-database, architecture-deployment-node, architecture-external-system, architecture-group, architecture-person, architecture-queue, architecture-system, architecture-system-boundary, card, code, decision, ellipse, formula, frame, freedraw, icon, image, junction, lane, note, participant, section, sequence, table, text",
    ],
    [
      "tone",
      "critical",
      "must be one of accent, danger, info, neutral, success, warning",
    ],
  ] as const;

  for (const [field, value, message] of cases) {
    const input = cloneManifest();
    const constructor = (input.constructors as Record<string, unknown>[])[0];
    const lowering = constructor.lowering as Record<string, unknown>;
    lowering[field] = value;
    const path = `manifest.constructors[0].lowering.${field}`;
    assert.throws(
      () => defineLibraryManifest(input),
      (error: unknown) => error instanceof LibraryManifestError
        && error.path === path
        && error.message === `${path}: ${message}`,
      field,
    );
  }
});

test("rejects endpoint property defaults without a lowering-compatible representation", () => {
  const input = cloneManifest();
  const constructor = (input.constructors as Record<string, unknown>[])[0];
  const properties = constructor.properties as Record<string, unknown>[];
  properties.push({
    name: "attach",
    kind: "endpoint",
    required: false,
    synopsis: "Attachment target.",
  });
  const defaults = constructor.defaults as Record<string, unknown>;
  (defaults.properties as Record<string, unknown>).attach = "target@right";

  const path = "manifest.constructors[0].defaults.properties.attach";
  assert.throws(
    () => defineLibraryManifest(input),
    (error: unknown) => error instanceof LibraryManifestError
      && error.path === path
      && error.message === `${path}: cannot default an endpoint property`,
  );
});

test("rejects malformed child policies and non-JSON data", () => {
  const impossibleCardinality = cloneManifest();
  const children = ((impossibleCardinality.constructors as Record<string, unknown>[])[0].children) as Record<string, unknown>;
  const role = (children.roles as Record<string, unknown>[])[0];
  role.minimum = 2;
  role.maximum = 1;
  assert.throws(() => defineLibraryManifest(impossibleCardinality), /must be greater than or equal to minimum/);

  const nonJson = cloneManifest();
  const defaults = ((nonJson.constructors as Record<string, unknown>[])[0].defaults) as Record<string, unknown>;
  (defaults.properties as Record<string, unknown>).tone = () => "neutral";
  assert.throws(() => defineLibraryManifest(nonJson), /must be JSON-serializable data/);
});
