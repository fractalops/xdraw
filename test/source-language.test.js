import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssets } from "../src/assets.js";
import { compile } from "../src/compiler.js";
import { MemoryFileSystem } from "../src/filesystem.js";
import { parseSource, parseSyntax } from "../src/source-language.js";

const FLOW = `
use "xdraw/palette" as palette
use "xdraw/process" as process
use "xdraw/cards" as cards

diagram "Request lifecycle" {
  subtitle "A compact flow"

  flow: process.lane "Processing" {
    arrange row { gap 55 }

    request: cards.card "Request" { style palette.info }
    validate: rectangle "Validate" {
      body "Check the request"
      style palette.warning
    }
    publish: cards.card "Publish" { style palette.success }
    request@right -> validate@left -> publish@left
  }
}`;

test("parses generic declarations without architecture-specific grammar", () => {
  const syntax = parseSyntax(FLOW);
  assert.deepEqual(syntax.imports.map(({ source, alias }) => ({ source, alias })), [
    { source: "xdraw/palette", alias: "palette" },
    { source: "xdraw/process", alias: "process" },
    { source: "xdraw/cards", alias: "cards" },
  ]);
  const flow = syntax.diagram.statements.find((statement) => statement.id === "flow");
  assert.equal(flow.constructor, "process.lane");
  assert.equal(flow.statements.find((statement) => statement.id === "validate").constructor, "rectangle");
});

test("lowers generic declarations through the production compiler", () => {
  const drawing = compile(parseSource(FLOW)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "flow.request:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "flow.validate:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "flow.publish:frame"));
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("qualified references and anchors remain unambiguous after lowering", () => {
  const document = parseSource(`diagram "Namespaces" {
    source: frame "Source" {
      api: rectangle "API" { at (80, 120); size (220, 100) }
    }
    target: frame "Target" {
      store: ellipse "Store" { at (480, 120); size (220, 100) }
    }
    transfer: source.api@right -> target.store@left "copies"
  }`);
  const connection = document.statements.find((statement) => statement.type === "connection");
  assert.deepEqual(connection.nodes, ["source.api.right", "target.store.left"]);
  const drawing = compile(document).toJSON();
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("rejects constructors that are not provided by the core or an imported library", () => {
  assert.throws(
    () => parseSource('diagram "Unknown" { item: architecture.service "API" }'),
    /unknown constructor 'architecture\.service'/,
  );
});

test("arrangements own nested groups and flowing text", () => {
  const drawing = compile(parseSource(`diagram "Comparison" {
    arrange compact { width 1600 }
    comparison: frame "Comparison" {
      arrange column { gap 24 }
      histories: group {
        arrange row { gap 32 }
        source: frame "Source" { source_row: rectangle "Version 12" }
        target: frame "Target" { target_row: rectangle "Version 0" }
        source.source_row@right -> target.target_row@left "copied"
      }
      explanation: text "The copied rows have a new path and version history."
    }
  }`)).toJSON();

  const source = drawing.elements.find((element) => element.id === "comparison.histories.source");
  const target = drawing.elements.find((element) => element.id === "comparison.histories.target");
  const explanation = drawing.elements.find((element) => element.id === "comparison.explanation");
  assert.ok(source.x < target.x);
  assert.ok(explanation.y > source.y + source.height);
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("qualified sequence constructors lower without sequence keywords", () => {
  const drawing = compile(parseSource(`
    use "xdraw/sequence" as seq
    diagram "Interaction" {
      interaction: seq.diagram {
        client: seq.participant "Client"
        server: seq.participant "Server"
        request: client -> server "Request"
      }
    }
  `)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "interaction.client:lifeline"));
  assert.ok(drawing.elements.some((element) => element.id === "interaction.server:lifeline"));
});

test("components expand hygienically from constructor declarations", () => {
  const drawing = compile(parseSource(`
    use "xdraw/architecture" as arch
    use "xdraw/palette" as palette
    diagram "Services" {
      service: component(name, visual_style) {
        api: arch.system "${"${name}"} API" { style $visual_style }
        store: arch.database "${"${name}"} store"
        api -> store
      }
      orders: service("Orders", palette.info)
      billing: service("Billing", palette.warning)
      orders.api -> billing.api
    }
  `)).toJSON();
  assert.ok(drawing.elements.some((element) => element.id === "orders.api:frame"));
  assert.ok(drawing.elements.some((element) => element.id === "billing.store:frame"));
});

test("components compose without leaking identifiers", () => {
  const drawing = compile(parseSource(`diagram "Composition" {
    leaf: component(name) { node: rectangle "${"${name}"}" }
    pair: component(name) {
      left: leaf("${"${name}"} left")
      right: leaf("${"${name}"} right")
    }
    first: pair("First")
    second: pair("Second")
  }`)).toJSON();
  for (const id of [
    "first.left.node:frame",
    "first.right.node:frame",
    "second.left.node:frame",
    "second.right.node:frame",
  ]) assert.ok(drawing.elements.some((element) => element.id === id));
});

test("component diagnostics report missing parameters and cycles", () => {
  assert.throws(
    () => compile(parseSource('diagram "Missing" { item: component(name) { node: rectangle "${name}" }; use: item() }')),
    /is missing parameters: name/,
  );
  assert.throws(
    () => compile(parseSource(`diagram "Cycle" {
      first: component() { nested: second() }
      second: component() { nested: first() }
      root: first()
    }`)),
    /component cycle: first -> second -> first/,
  );
});

test("named styles, frame locks, and connector waypoints share property syntax", () => {
  const drawing = compile(parseSource(`diagram "Controls" {
    focus: style { stroke "#059669"; background "#ecfdf5" }
    workspace: frame "Workspace" {
      locked true
      source: rectangle "Source" { at (80, 120); size (180, 90); style focus }
      target: ellipse "Target" { at (520, 120); size (180, 90) }
      source@right -> target@left {
        via ((300, 165), (440, 165))
        start-label "caller"
      }
    }
  }`)).toJSON();
  assert.equal(drawing.elements.find((element) => element.id === "workspace").locked, true);
  assert.ok(drawing.elements.some((element) => element.type === "arrow"));
});

test("connection route properties select the rendered path style", () => {
  const drawing = compile(parseSource(`use "xdraw/connectors" as connectors
  diagram "Curved connection" {
    left: connectors.junction "" { at (80, 120); size (8, 8); opacity 0 }
    right: connectors.junction "" { at (420, 120); size (8, 8); opacity 0 }
    left@right -> right@left {
      route curved
      via ((220, 220), (300, 220))
      head none
    }
  }`)).toJSON();
  const edge = drawing.elements.find((element) => element.id === "document:connection:0:0");

  assert.deepEqual(edge.roundness, { type: 2 });
  assert.equal(edge.endArrowhead, null);
  assert.equal(edge.points.length, 4);
});

test("rightward tree arrangements preserve qualified node identities", () => {
  const drawing = compile(parseSource(`
    use "xdraw/containers" as containers
    use "xdraw/cards" as cards
    diagram "Language design" {
      map: containers.section "XDraw" {
        arrange tree {
          root root
          direction right
          level-gap 90
          sibling-gap 28
        }
        root: cards.card "XDraw"
        syntax: cards.card "Syntax"
        layout: cards.card "Layout"
        ids: cards.card "Stable IDs"
        root -> syntax
        root -> layout
        syntax -> ids
      }
    }
  `)).toJSON();

  const root = drawing.elements.find((element) => element.id === "map.root:frame");
  const syntax = drawing.elements.find((element) => element.id === "map.syntax:frame");
  const ids = drawing.elements.find((element) => element.id === "map.ids:frame");
  assert.ok(root.x < syntax.x);
  assert.ok(syntax.x < ids.x);
  const arrows = drawing.elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 3);
  assert.ok(arrows.every((arrow) => arrow.points.every((point, index) => (
    index === 0 || point[0] >= arrow.points[index - 1][0]
  ))));
});

test("tree arrangements reject ambiguous and cyclic topology", () => {
  assert.throws(
    () => parseSource(`diagram "Ambiguous" {
      map: frame "Map" {
        arrange tree { root root }
        root: rectangle "Root"
        first: rectangle "First"
        second: rectangle "Second"
        root -> second
        first -> second
      }
    }`),
    /tree node 'map\.second' has more than one parent/,
  );
  assert.throws(
    () => parseSource(`diagram "Cycle" {
      map: frame "Map" {
        arrange tree { root root }
        root: rectangle "Root"
        child: rectangle "Child"
        root -> child
        child -> root
      }
    }`),
    /tree node 'map\.root' has more than one parent|contains a cycle/,
  );
});

test("notes attach to semantic anchors and remain connectable", () => {
  const drawing = compile(parseSource(`
    use "xdraw/annotations" as annotations
    use "xdraw/cards" as cards
    diagram "Investigation" {
      source: cards.card "Source snapshot"
      target: cards.card "Candidate output"
      source -> target "compare"
      mismatch: annotations.note "Three records differ" { attach target@bottom }
      owner: annotations.callout "Confirm expected semantics"
      owner -> mismatch
    }
  `)).toJSON();

  assert.ok(drawing.elements.some((element) => element.id === "mismatch:frame"));
  assert.equal(drawing.elements.filter((element) => element.type === "arrow").length, 2);
});

test("assets, images, and library icons resolve through the normal asset pipeline", async () => {
  const filesystem = new MemoryFileSystem({
    "mark.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>',
  });
  const document = parseSource(`
    use "xdraw/assets" as assets
    diagram "Portable assets" {
      logo: asset "mark.svg"
      hero: image(logo) { at (100, 100); size (320, 160); fit contain; alt "Mark" }
      mark: assets.icon(logo) { at (470, 120); size (80, 80); fit contain }
    }
  `);
  const drawing = compile(await resolveAssets(document, filesystem)).toJSON();

  assert.equal(drawing.elements.find((element) => element.id === "hero").type, "image");
  assert.equal(drawing.elements.find((element) => element.id === "mark").type, "image");
  assert.equal(Object.keys(drawing.files).length, 1);
});

test("precision transforms resolve namespaced selections before geometry", () => {
  const drawing = compile(parseSource(`diagram "Geometry" {
    workspace: frame "Workspace" {
      first: rectangle "First" { at (80, 100); size (100, 80) }
      second: rectangle "Second" { at (330, 180); size (140, 100) }
      third: rectangle "Third" { at (700, 260); size (120, 90) }
      align top (first, second, third)
      distribute x (first, second, third)
      match-size (first, third) height
      offset (second) by (10, 0)
      rotate (third) 15
      snap (first) to 10
    }
  }`)).toJSON();
  const frames = ["first", "second", "third"].map((id) => (
    drawing.elements.find((element) => element.id === `workspace.${id}:frame`)
  ));
  assert.equal(frames[0].y, frames[1].y);
  assert.equal(frames[0].height, frames[2].height);
  assert.notEqual(frames[2].angle, 0);
});
