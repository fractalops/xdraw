import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { compile } from "../src/pipeline.ts";
import { alignBounds, box, column, distributeBounds, inset, row } from "../src/geometry.ts";
import { measureRouteQuality } from "../src/route-quality.ts";
import { formatSceneResource, parseSceneResource } from "../src/scene-document.ts";
import { parseSource } from "../src/source-language.ts";
import { tokenize } from "../src/tokenizer.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "250", 10);

if (!Number.isInteger(RUNS) || RUNS <= 0) {
  throw new Error("XDRAW_PROPERTY_RUNS must be a positive integer");
}

const identifier = fc.array(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-"),
  { minLength: 1, maxLength: 12 },
).map((parts) => `n${parts.join("")}`);

const title = fc.array(
  fc.constantFrom("a", "b", " ", "-", "_", "\n", "\t", '"', "\\", "🙂", "日"),
  { maxLength: 40 },
).map((parts) => parts.join(""));

const bounds = fc.record({
  x: fc.integer({ min: -1_000, max: 1_000 }),
  y: fc.integer({ min: -1_000, max: 1_000 }),
  width: fc.integer({ min: 1, max: 500 }),
  height: fc.integer({ min: 1, max: 500 }),
});

const layoutInput = fc.record({
  width: fc.integer({ min: 1, max: 200 }),
  height: fc.integer({ min: 1, max: 200 }),
  count: fc.integer({ min: 1, max: 10 }),
  gap: fc.integer({ min: 0, max: 100 }),
  padding: fc.integer({ min: 0, max: 100 }),
});

const point = fc.tuple(
  fc.integer({ min: -100, max: 100 }),
  fc.integer({ min: -100, max: 100 }),
);

function quote(value) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")}"`;
}

function assertDrawingIntegrity(drawing) {
  const ids = new Set(drawing.elements.map((element) => element.id));
  assert.equal(ids.size, drawing.elements.length);

  for (const element of drawing.elements) {
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(Number.isFinite(element[key]), `${element.id}.${key} must be finite`);
    }
    assert.ok(element.width >= 0 && element.height >= 0);
    if (element.containerId) assert.ok(ids.has(element.containerId));
    for (const binding of element.boundElements ?? []) assert.ok(ids.has(binding.id));
    if (element.startBinding) assert.ok(ids.has(element.startBinding.elementId));
    if (element.endBinding) assert.ok(ids.has(element.endBinding.elementId));
  }
}

test("property: scene resource addresses round-trip", () => {
  const segment = fc.stringMatching(/^[^:\r\n]{1,24}$/u).filter((value) => value.trim().length > 0);
  fc.assert(fc.property(segment, segment, segment, (workspace, collection, scene) => {
    const resource = { provider: "excalidraw", workspace, collection, scene };
    assert.deepEqual(parseSceneResource(formatSceneResource(resource)), resource);
  }), { numRuns: RUNS });
});

test("property: layout helpers emit positive geometry or reject impossible input", () => {
  fc.assert(fc.property(layoutInput, ({ width, height, count, gap, padding }) => {
    const parent = box(0, 0, width, height);

    if (width - gap * (count - 1) <= 0) {
      assert.throws(() => row(parent, count, gap), /positive child width/);
    } else {
      assert.ok(row(parent, count, gap).every((child) => child.width > 0 && child.height > 0));
    }

    if (height - gap * (count - 1) <= 0) {
      assert.throws(() => column(parent, count, gap), /positive child height/);
    } else {
      assert.ok(column(parent, count, gap).every((child) => child.width > 0 && child.height > 0));
    }

    if (width - padding * 2 <= 0 || height - padding * 2 <= 0) {
      assert.throws(() => inset(parent, padding), /positive width and height/);
    } else {
      const child = inset(parent, padding);
      assert.ok(child.width > 0 && child.height > 0);
    }
  }), { numRuns: RUNS });
});

test("property: alignment and distribution are exactly idempotent", () => {
  fc.assert(fc.property(
    fc.array(bounds, { minLength: 3, maxLength: 20 }),
    fc.constantFrom("left", "center-x", "right", "top", "center-y", "bottom"),
    (items, mode) => {
      const aligned = alignBounds(items, mode);
      assert.deepEqual(alignBounds(aligned, mode), aligned);
    },
  ), { numRuns: RUNS });

  fc.assert(fc.property(
    fc.array(bounds, { minLength: 3, maxLength: 20 }),
    fc.constantFrom("x", "y"),
    (items, axis) => {
      const distributed = distributeBounds(items, axis);
      assert.deepEqual(distributeBounds(distributed, axis), distributed);
    },
  ), { numRuns: RUNS });
});

test("property: tokenizer metadata remains inside its source", () => {
  fc.assert(fc.property(fc.string({ maxLength: 300 }), (source) => {
    try {
      const tokens = tokenize(source);
      for (const token of [...tokens, ...tokens.comments]) {
        assert.equal(token.raw, source.slice(token.offset, token.end));
        assert.ok(token.offset >= 0 && token.end >= token.offset && token.end <= source.length);
        assert.equal(token.start.offset, token.offset);
        assert.equal(token.finish.offset, token.end);
      }
      assert.equal(tokens.at(-1).type, "eof");
      assert.equal(tokens.at(-1).offset, source.length);
    } catch (error) {
      if (error?.name !== "XDrawSyntaxError") throw error;
    }
  }), { numRuns: RUNS });
});

test("property: generated diagrams compile deterministically with valid references", () => {
  const nodes = fc.uniqueArray(fc.record({
    id: identifier,
    title,
    kind: fc.constantFrom("rectangle", "ellipse", "diamond"),
  }), { selector: (item) => item.id, minLength: 1, maxLength: 12 });

  fc.assert(fc.property(nodes, fc.array(fc.boolean(), { maxLength: 11 }), (items, connections) => {
    const declarations = items.map((item) => `${item.id}: ${item.kind} ${quote(item.title)}`);
    const edges = connections
      .slice(0, Math.max(0, items.length - 1))
      .flatMap((enabled, index) => enabled ? [`${items[index].id} -> ${items[index + 1].id}`] : []);
    const source = `diagram "Generated" {
      arrange grid { columns 3; gap 24 }
      ${[...declarations, ...edges].join("\n")}
    }`;
    const first = compile(parseSource(source)).toJSON();
    const second = compile(parseSource(source)).toJSON();
    assert.deepEqual(first, second);
    assertDrawingIntegrity(first);
  }), { numRuns: RUNS });
});

test("property: route quality ignores route ordering and direction", () => {
  fc.assert(fc.property(
    fc.array(fc.array(point, { minLength: 2, maxLength: 8 }), { maxLength: 10 }),
    (routes) => {
      const expected = measureRouteQuality(routes);
      assert.deepEqual(measureRouteQuality([...routes].reverse()), expected);
      assert.deepEqual(measureRouteQuality(routes.map((route) => [...route].reverse())), expected);
    },
  ), { numRuns: RUNS });
});
