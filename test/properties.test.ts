import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { compilePrepared as compile, compile as compileAsync } from "../src/compile/pipeline.ts";
import { alignBounds, anchor, box, column, distributeBounds, inset, row } from "../src/geometry.ts";
import { measureRouteQuality } from "../src/routing/quality.ts";
import { formatSceneResource, parseSceneDocument, parseSceneResource } from "../src/io/scene-document.ts";
import { parseSource } from "../src/language/parser.ts";
import { getLibraryManifest } from "../src/language/registry.ts";
import { tokenize } from "../src/language/tokenizer.ts";
import { NOT_A_TYPO } from "../src/language/validator.ts";
import { routeConnection } from "../src/routing/router.ts";
import { planScenePatch } from "../src/excalidraw-api.ts";
import type { Route } from "../src/contracts/foundation.ts";
import type { DrawingJson } from "../src/contracts/render.ts";
import type { SceneContentResource } from "../src/excalidraw-api.ts";
import type { SceneResource } from "../src/io/scene-document.ts";

const RUNS = Number.parseInt(process.env.XDRAW_PROPERTY_RUNS ?? "250", 10);
const EXPENSIVE_RUNS = Math.min(RUNS, 25);

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

function quote(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")}"`;
}

function assertDrawingIntegrity(drawing: DrawingJson): void {
  const ids = new Set(drawing.elements.map((element) => element.id));
  assert.equal(ids.size, drawing.elements.length);

  for (const element of drawing.elements) {
    for (const [key, value] of [["x", element.x], ["y", element.y], ["width", element.width], ["height", element.height]] as const) {
      assert.ok(Number.isFinite(value), `${element.id}.${key} must be finite`);
    }
    assert.ok(element.width >= 0 && element.height >= 0);
    if ("containerId" in element && element.containerId) assert.ok(ids.has(element.containerId));
    for (const binding of element.boundElements ?? []) assert.ok(ids.has(binding.id));
    if ((element.type === "arrow" || element.type === "line") && element.startBinding) {
      assert.ok(ids.has(element.startBinding.elementId));
    }
    if ((element.type === "arrow" || element.type === "line") && element.endBinding) {
      assert.ok(ids.has(element.endBinding.elementId));
    }
  }
}

function validDocumentSource({ family, heading, labels, gap }: {
  family: string;
  heading: string;
  labels: string[];
  gap: number;
}): string {
  const [first, second, third] = labels;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  if (family === "core") {
    return `diagram ${quote(heading)} {
      base: theme { font-family = normal }
      focus: style { stroke = "#2563eb"; background = "#dbeafe" }
      region: frame ${quote(first)} {
        arrange row { gap = ${gap} }
        left: rectangle ${quote(second)} { style = focus }
        right: ellipse ${quote(third)}
        left@east -> right@west ${quote(heading)}
      }
      caption: text ${quote(first)} { at = (20, 320); wrap-width = 240 }
    }`;
  }
  if (family === "template") {
    return `diagram ${quote(heading)} {
      item: template(label) { node: rectangle "${"${label}"}" }
      first: item(${quote(first)})
      second: item(${quote(second)})
      first.node -> second.node ${quote(third)}
    }`;
  }
  if (family === "architecture") {
    return `use "xdraw/architecture" as arch
    diagram ${quote(heading)} {
      user: arch.person ${quote(first)}
      system: arch.system ${quote(second)}
      data: arch.database ${quote(third)}
      user -> system ${quote(heading)}
      system -> data
    }`;
  }
  if (family === "sequence") {
    return `use "xdraw/sequence" as seq
    diagram ${quote(heading)} {
      interaction: seq.sequence {
        first: seq.participant ${quote(first)}
        second: seq.participant ${quote(second)}
        request: first -> second ${quote(third)}
      }
    }`;
  }
  return `use "xdraw/annotations" as annotations
  diagram ${quote(heading)} {
    source: rectangle ${quote(first)}
    target: rectangle ${quote(second)}
    source -> target
    note: annotations.note ${quote(third)} { attach = target@south }
  }`;
}

const validDocument = fc.record({
  family: fc.constantFrom("core", "template", "architecture", "sequence", "annotation"),
  heading: title,
  labels: fc.array(title, { minLength: 3, maxLength: 3 }),
  gap: fc.integer({ min: 0, max: 100 }),
}).map(validDocumentSource);

const invalidDocument = fc.record({
  kind: fc.constantFrom("duplicate", "unknown-reference", "sequence-child", "table-width"),
  id: identifier,
  label: title,
}).map(({ kind, id, label }) => {
  if (kind === "duplicate") {
    return {
      source: `diagram "Invalid" { ${id}: rectangle ${quote(label)}; ${id}: ellipse "Again" }`,
      expected: /duplicate/u,
    };
  }
  if (kind === "unknown-reference") {
    return {
      source: `diagram "Invalid" { ${id}: rectangle ${quote(label)}; ${id} -> missing }`,
      expected: /unknown/u,
    };
  }
  if (kind === "sequence-child") {
    return {
      source: `use "xdraw/sequence" as seq
        diagram "Invalid" { flow: seq.sequence { ${id}: rectangle ${quote(label)} } }`,
      expected: /sequence/u,
    };
  }
  return {
    source: `use "xdraw/table" as table
      diagram "Invalid" {
        ${id}: table.table ${quote(label)} {
          table.header "One" "Two"
          table.row "Only one"
        }
      }`,
    expected: /expected 2/u,
  };
});

test("property: scene resource addresses round-trip", () => {
  const segment = fc.stringMatching(/^[^:\r\n]{1,24}$/u).filter((value) => value.trim().length > 0);
  fc.assert(fc.property(segment, segment, segment, (workspace, collection, scene) => {
    const resource: SceneResource = { provider: "excalidraw", workspace, collection, scene };
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
      const last = tokens.at(-1);
      assert.ok(last);
      assert.equal(last.type, "eof");
      assert.equal(last.offset, source.length);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "XDrawSyntaxError") throw error;
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
      arrange grid { columns = 3; gap = 24 }
      ${[...declarations, ...edges].join("\n")}
    }`;
    const first = compile(parseSource(source)).toJSON();
    const second = compile(parseSource(source)).toJSON();
    assert.deepEqual(first, second);
    assertDrawingIntegrity(first);
  }), { numRuns: RUNS });
});

test("property: relative placement preserves authored gaps across measured sizes", () => {
  fc.assert(fc.property(
    fc.record({
      firstWidth: fc.integer({ min: 80, max: 320 }),
      firstHeight: fc.integer({ min: 60, max: 180 }),
      secondWidth: fc.integer({ min: 80, max: 320 }),
      secondHeight: fc.integer({ min: 60, max: 180 }),
      gap: fc.integer({ min: 0, max: 800 }),
    }),
    ({ firstWidth, firstHeight, secondWidth, secondHeight, gap }) => {
      const drawing = compile(parseSource(`diagram "Relative property" {
        first: rectangle "First" { size = (${firstWidth}, ${firstHeight}) }
        second: rectangle "Second" {
          at = (first.bounds.right + ${gap}, y(first.center) - ${secondHeight / 2})
          size = (${secondWidth}, ${secondHeight})
        }
      }`)).toJSON();
      const first = drawing.elements.find((element) => element.id === "first:frame");
      const second = drawing.elements.find((element) => element.id === "second:frame");
      const container = drawing.elements.find((element) => element.id === "diagram:frame");
      assert.ok(first && second && container);
      assert.equal(second.x, first.x + first.width + gap);
      assert.equal(second.y + second.height / 2, first.y + first.height / 2);
      assert.ok(container.x + container.width >= second.x + second.width);
      assertDrawingIntegrity(drawing);
    },
  ), { numRuns: RUNS });
});

test("property: route quality ignores route ordering and direction", () => {
  fc.assert(fc.property(
    fc.array(fc.array(point, { minLength: 2, maxLength: 8 }), { maxLength: 10 }),
    (routes) => {
      const typedRoutes = routes as Route[];
      const expected = measureRouteQuality(typedRoutes);
      assert.deepEqual(measureRouteQuality([...typedRoutes].reverse()), expected);
      assert.deepEqual(measureRouteQuality(typedRoutes.map((route) => [...route].reverse() as Route)), expected);
    },
  ), { numRuns: RUNS });
});

test("property: grammar-aware documents compile deterministically", () => {
  fc.assert(fc.property(validDocument, (source) => {
    const document = parseSource(source);
    const first = compile(document).toJSON();
    const second = compile(parseSource(source)).toJSON();
    assert.deepEqual(second, first);
    assertDrawingIntegrity(first);
    assert.ok(first.elements.length > 0);
  }), { numRuns: RUNS });
});

test("property: invalid semantic programs fail closed", () => {
  fc.assert(fc.property(invalidDocument, ({ source, expected }) => {
    assert.throws(() => compile(parseSource(source)), expected);
  }), { numRuns: RUNS });
});

test("property: scene patch documents preserve their authored model", () => {
  const updates = fc.uniqueArray(fc.record({ target: identifier, title }), {
    selector: ({ target }) => target,
    minLength: 1,
    maxLength: 5,
  });
  const patch = fc.record({
    workspace: identifier,
    collection: identifier,
    scene: identifier,
    updates,
    deleteCandidates: fc.uniqueArray(identifier, { maxLength: 5 }),
    add: fc.boolean(),
  });

  fc.assert(fc.property(patch, ({ workspace, collection, scene, updates: authoredUpdates, deleteCandidates, add }) => {
    const updated = new Set(authoredUpdates.map(({ target }) => target));
    const deletes = deleteCandidates.filter((target) => !updated.has(target));
    const updateSource = authoredUpdates
      .map(({ target, title: value }) => `update ${target} { title = ${quote(value)} }`)
      .join("\n");
    const deleteSource = deletes.map((target) => `delete ${target}`).join("\n");
    const addSource = add ? 'add { added: rectangle "Added" }' : "";
    const source = `scene excalidraw::${workspace}::${collection}::${scene} {
      patch { ${updateSource}\n${deleteSource}\n${addSource} }
    }`;
    const parsed = parseSceneDocument(source);
    assert.equal(formatSceneResource(parsed.resource), `excalidraw::${workspace}::${collection}::${scene}`);
    assert.equal(parsed.operation.type, "patch");
    assert.deepEqual(parsed.operation.updates, authoredUpdates.map(({ target, title: value }) => ({
      target,
      properties: { title: value },
    })));
    assert.deepEqual(parsed.operation.deletes, deletes);
    assert.equal(Boolean(parsed.operation.additions), add);
  }), { numRuns: RUNS });
});

test("property: arbitrary hosted scene patches preserve identities, bindings and order", () => {
  const scenePatch = fc.record({
    nodes: fc.uniqueArray(fc.record({ id: identifier, title }), {
      selector: ({ id }) => id,
      minLength: 1,
      maxLength: 8,
    }),
    actions: fc.array(fc.constantFrom("keep", "update", "delete"), { maxLength: 8 }),
    additions: fc.uniqueArray(identifier, { maxLength: 4 }),
  });

  fc.assert(fc.property(scenePatch, ({ nodes, actions, additions }) => {
    const source = `diagram "Existing" { ${nodes.map(({ id, title: value }) => (
      `${id}: rectangle ${quote(value || id)}`
    )).join("\n")} }`;
    const original = compile(parseSource(source)).toJSON();
    const originalElements = original.elements.map((element) => {
      const node = nodes.find(({ id }) => element.id === `${id}:frame`);
      return node
        ? { ...element, index: `a${nodes.indexOf(node)}`, customData: { ...(element.customData ?? {}), xdrawId: node.id } }
        : element;
    });
    const content = { ...original, elements: originalElements } as SceneContentResource;
    const updates = nodes.flatMap(({ id }, index) => actions[index] === "update"
      ? [{ target: id, properties: { title: `updated ${id}`, x: index * 17 } }]
      : []);
    const deletes = nodes.flatMap(({ id }, index) => actions[index] === "delete" ? [id] : []);
    const additionIds = additions.filter((id) => !nodes.some((node) => node.id === `new_${id}`))
      .map((id) => `new_${id}`);
    const additionDrawing = additionIds.length
      ? compile(parseSource(`diagram "Additions" { ${additionIds.map((id) => `${id}: ellipse "New"`).join("\n")} }`)).toJSON()
      : undefined;
    const drawing = additionDrawing && {
      ...additionDrawing,
      elements: additionDrawing.elements.filter((element) => additionIds.some((id) => element.id.startsWith(`${id}:`))),
    };
    const snapshot = structuredClone(content);
    const plan = planScenePatch(content, { updates, deletes, drawing }, 123_456);

    assert.deepEqual(content, snapshot);
    assert.equal(plan.updated, updates.length);
    assert.equal(plan.deleted, deletes.length);
    assert.equal(plan.added, drawing?.elements.length ?? 0);
    for (const { target, properties } of updates) {
      const shape = plan.elements.find((element) => element.customData?.xdrawId === target);
      const originalShape = content.elements.find((element) => element.customData?.xdrawId === target);
      assert.ok(shape && originalShape);
      assert.equal(shape.version, originalShape.version + 1);
      assert.equal(shape.x, properties.x);
      const labelId = originalShape.boundElements?.find((bound) => bound.type === "text")?.id;
      const label = plan.elements.find((element) => element.id === labelId);
      assert.equal(label?.type, "text");
      if (label?.type === "text") assert.equal(label.text, properties.title);
    }
    for (const target of deletes) {
      const shape = plan.elements.find((element) => element.customData?.xdrawId === target);
      assert.equal(shape?.isDeleted, true);
      const labelId = content.elements.find((element) => element.customData?.xdrawId === target)
        ?.boundElements?.find((bound) => bound.type === "text")?.id;
      assert.equal(plan.elements.find((element) => element.id === labelId)?.isDeleted, true);
    }
    const added = plan.elements.slice(plan.elements.length - (drawing?.elements.length ?? 0));
    assert.ok(added.every((element, index) => index === 0 || (element.index ?? "") > (added[index - 1].index ?? "")));
    assert.equal(new Set(added.map(({ id }) => id)).size, added.length);
  }), { numRuns: RUNS });
});

test("property: routed connections remain orthogonal and avoid intervening nodes", () => {
  const routedCase = fc.record({
    y: fc.integer({ min: -500, max: 500 }),
    nodeWidth: fc.integer({ min: 40, max: 240 }),
    nodeHeight: fc.integer({ min: 40, max: 180 }),
    obstacleWidth: fc.integer({ min: 40, max: 240 }),
    gap: fc.integer({ min: 80, max: 240 }),
  });
  fc.assert(fc.property(routedCase, ({ y, nodeWidth, nodeHeight, obstacleWidth, gap }) => {
    const from = box(0, y, nodeWidth, nodeHeight);
    const obstacle = box(nodeWidth + gap, y - 30, obstacleWidth, nodeHeight + 60);
    const to = box(obstacle.x + obstacle.width + gap, y, nodeWidth, nodeHeight);
    const scene = {
      bounds: new Map([["from", from], ["obstacle", obstacle], ["to", to]]),
      nodeIds: new Set(["from", "obstacle", "to"]),
      containers: [],
      routes: [],
    };
    const route = routeConnection(scene, "from", "to", from, to, "right", "left");
    assert.deepEqual(route[0], anchor.right(from));
    assert.deepEqual(route.at(-1), anchor.left(to));
    assert.ok(route.every(([x, pointY]) => Number.isFinite(x) && Number.isFinite(pointY)));
    assert.ok(route.slice(1).every(([x, pointY], index) => x === route[index][0] || pointY === route[index][1]));
    assert.equal(measureRouteQuality([route], [obstacle]).obstacleIntersections, 0);
  }), { numRuns: RUNS });
});

test("property: arranged children remain inside their frame", () => {
  const arrangement = fc.record({
    kind: fc.constantFrom("row", "column"),
    gap: fc.integer({ min: 0, max: 100 }),
    first: title,
    second: title,
  });
  fc.assert(fc.property(arrangement, ({ kind, gap, first, second }) => {
    const drawing = compile(parseSource(`diagram "Layout" {
      region: frame "Region" {
        arrange ${kind} { gap = ${gap} }
        first: rectangle ${quote(first)}
        second: ellipse ${quote(second)}
      }
    }`)).toJSON();
    assertDrawingIntegrity(drawing);
    const frame = drawing.elements.find(({ id }) => id === "region");
    assert.ok(frame);
    for (const id of ["region.first:frame", "region.second:frame"]) {
      const child = drawing.elements.find((element) => element.id === id);
      assert.ok(child);
      assert.ok(child.x >= frame.x && child.y >= frame.y);
      assert.ok(child.x + child.width <= frame.x + frame.width);
      assert.ok(child.y + child.height <= frame.y + frame.height);
    }
  }), { numRuns: RUNS });
});

test("property: generated tables retain rectangular cell geometry", () => {
  const nonEmptyCell = title.filter((value) => value.trim().length > 0);
  const table = fc.integer({ min: 1, max: 6 }).chain((columnCount) => fc.record({
    headers: fc.array(nonEmptyCell, { minLength: columnCount, maxLength: columnCount }),
    rows: fc.array(fc.array(title, { minLength: columnCount, maxLength: columnCount }), {
      minLength: 1,
      maxLength: 10,
    }),
  }));
  fc.assert(fc.property(table, ({ headers, rows }) => {
    const source = `use "xdraw/table" as table
      diagram "Generated table" {
        data: table.table "Data" {
          table.header ${headers.map(quote).join(" ")}
          ${rows.map((cells) => `table.row ${cells.map(quote).join(" ")}`).join("\n")}
        }
      }`;
    const drawing = compile(parseSource(source)).toJSON();
    assertDrawingIntegrity(drawing);
    const cellFrames = drawing.elements.filter(({ id }) => /data:(?:header|row:\d+):cell:\d+:frame$/u.test(id));
    assert.equal(cellFrames.length, headers.length * (rows.length + 1));
    assert.ok(cellFrames.every(({ width, height }) => width > 0 && height > 0));
    assert.ok(drawing.elements.filter(({ id }) => id.startsWith("data:")).every(
      ({ groupIds }) => groupIds.includes("data:group"),
    ));
  }), { numRuns: RUNS });
});

test("property: generated formulas compile deterministically with source metadata", async () => {
  const formula = fc.record({
    variable: fc.constantFrom("x", "y", "z", "a", "b"),
    numerator: fc.integer({ min: 1, max: 99 }),
    denominator: fc.integer({ min: 1, max: 99 }),
    exponent: fc.integer({ min: 1, max: 9 }),
  }).map(({ variable, numerator, denominator, exponent }) => (
    `\\frac{${numerator}}{${denominator}} + ${variable}^{${exponent}}`
  ));
  await fc.assert(fc.asyncProperty(formula, async (value) => {
    const source = `use "xdraw/math" as math
      diagram "Generated formula" { formula: math.formula """${value}""" }`;
    const first = (await compileAsync(parseSource(source))).toJSON();
    const second = (await compileAsync(parseSource(source))).toJSON();
    assert.deepEqual(second, first);
    assertDrawingIntegrity(first);
    const image = first.elements.find(({ id }) => id === "formula:image");
    assert.equal(image?.type, "image");
    assert.equal(image?.customData?.xdraw?.source, value);
  }), { numRuns: EXPENSIVE_RUNS });
});

test("property: a row grows every child by the same amount", () => {
  // `size` width is a starting width inside a row: it decides how many fit,
  // then the row grows them all to fill. Authored widths do not survive.
  const rowCase = fc.record({
    widths: fc.array(fc.integer({ min: 60, max: 260 }), { minLength: 2, maxLength: 4 }),
    gap: fc.integer({ min: 0, max: 40 }),
  });
  fc.assert(fc.property(rowCase, ({ widths, gap }) => {
    const children = widths
      .map((width, index) => `n${index}: rectangle "N${index}" { size = (${width}, 80) }`)
      .join("\n");
    const drawing = compile(parseSource(`diagram "Row" {
      arrange grid { columns = 1; width = 1400 }
      strip: frame "Strip" {
        arrange row { gap = ${gap} }
        ${children}
      }
    }`)).toJSON();
    const rendered = widths.map((_, index) => {
      const element = drawing.elements.find((candidate) => candidate.id === `strip.n${index}:frame`);
      assert.ok(element, "every child renders");
      return element;
    });
    // Free space is shared equally, so differences between authored widths
    // survive exactly while the widths themselves do not.
    const grown = rendered.map((element, index) => Math.round(element.width) - widths[index]);
    const distinctGrowth = new Set(grown);
    assert.equal(
      distinctGrowth.size, 1,
      `each child must grow by the same amount, got ${[...distinctGrowth].join(", ")}`,
    );
    assert.ok(grown[0] >= 0, "a row grows children, never shrinks them");
    // They also all sit on one line while they fit.
    assert.equal(new Set(rendered.map((element) => Math.round(element.y))).size, 1);
  }), { numRuns: RUNS });
});

test("property: a column keeps the width each child asked for", () => {
  const columnCase = fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 4 });
  fc.assert(fc.property(columnCase, (widths) => {
    const children = widths
      .map((width, index) => `n${index}: rectangle "N${index}" { size = (${width}, 80) }`)
      .join("\n");
    const drawing = compile(parseSource(`diagram "Column" {
      arrange grid { columns = 1; width = 1400 }
      stack: frame "Stack" {
        arrange column { gap = 10 }
        ${children}
      }
    }`)).toJSON();
    widths.forEach((authored, index) => {
      const element = drawing.elements.find((item) => item.id === `stack.n${index}:frame`);
      assert.ok(element);
      assert.equal(Math.round(element.width), authored, `column child ${index} keeps its authored width`);
    });
  }), { numRuns: RUNS });
});

test("property: a single-keystroke typo of a constructor is corrected", () => {
  const manifest = getLibraryManifest("xdraw/core");
  assert.ok(manifest);
  const names = manifest.constructors.map((item) => item.name);
  const known = new Set(names);

  // delete, substitute, or transpose one character
  const mutated = fc.record({
    name: fc.constantFrom(...names),
    kind: fc.constantFrom("delete", "substitute", "transpose"),
    position: fc.nat(),
    replacement: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
  }).map(({ name, kind, position, replacement }) => {
    const index = position % name.length;
    if (kind === "delete") return { name, typo: name.slice(0, index) + name.slice(index + 1) };
    if (kind === "substitute") {
      return { name, typo: name.slice(0, index) + replacement + name.slice(index + 1) };
    }
    const swap = Math.min(index, name.length - 2);
    if (swap < 0) return { name, typo: name };
    return {
      name,
      typo: name.slice(0, swap) + name[swap + 1] + name[swap] + name.slice(swap + 2),
    };
  });

  fc.assert(fc.property(mutated, ({ name, typo }) => {
    // A mutation that lands on another real name is not a typo any more, and
    // one that lands on a word from another diagramming language is a word the
    // validator stays deliberately silent about.
    if (known.has(typo) || typo.length === 0 || NOT_A_TYPO.has(typo)) return;
    let message = "";
    try {
      parseSource(`diagram "D" { a: ${typo} "A" }`);
      return; // parsed for some other reason; nothing to assert
    } catch (error) {
      message = String(error instanceof Error ? error.message : error);
    }
    if (!message.includes("unknown constructor")) return;
    const suggested = /did you mean '([^']+)'/u.exec(message)?.[1];
    assert.ok(suggested, `no suggestion for '${typo}': ${message}`);
    // Naming any real constructor is not enough: a suggestion that compiles
    // into the wrong element is worse than none, so it must name the original.
    assert.equal(suggested, name, `'${typo}' came from '${name}' but suggested '${suggested}'`);
  }), { numRuns: RUNS });
});
