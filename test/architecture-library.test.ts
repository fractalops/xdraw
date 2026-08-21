import assert from "node:assert/strict";
import test from "node:test";

import {
  isArchitectureBoundaryKind,
  renderArchitectureNode,
} from "../src/nodes/architecture.ts";
import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { parseSource } from "../src/language/parser.ts";
import { requireElementById } from "../test-support/assertions.ts";
import type { NodeStatement } from "../src/contracts/semantic.ts";
import type { FrameElement, TextElement } from "../src/contracts/render.ts";

const SOURCE = `
use "xdraw/architecture" as arch

diagram "Architecture notation" {
  platform: arch.system-boundary "Order platform" {
    arrange row { gap = 120 }
    customer: arch.person "Customer" { description = "Places and tracks orders" }
    system: arch.system "Order system" { description = "Accepts and fulfils orders" }
    external: arch.external-system "Payments" { description = "Authorises card payments" }
    web: arch.container "Web application" {
      description = "Serves the customer experience"
      technology = "TypeScript"
    }
    api: arch.component "Order API" {
      description = "Coordinates order operations"
      technology = "Node.js"
    }
    orders: arch.database "Orders" {
      description = "Stores order state"
      technology = "PostgreSQL"
    }
    events: arch.queue "Events" {
      description = "Buffers order events"
      technology = "Kafka"
    }

    customer@east -> system@west "uses"
    system -> web "serves experience"
    web -> orders "reads orders" { technology = "SQL" }
    orders -> events "publishes changes" { technology = "Kafka protocol" }
    api -> external "charges"
  }

  internals: arch.container-boundary "Order service" {
    parser: arch.component "Request parser" {
      description = "Validates incoming commands"
      technology = "TypeScript"
    }
  }

  runtime: arch.deployment-node "Production cluster" {
    process: arch.container "Order process" {
      description = "Runs the order service"
      technology = "Node.js"
    }
  }

  domain: arch.group "Order domain" {
    catalogue: arch.system "Product catalogue" {
      description = "Owns products and prices"
    }
  }
}`;

test("architecture constructors lower to distinct semantic kinds", () => {
  const document = parseSource(SOURCE);
  const boundary = document.statements.find((item) => item.id === "platform");
  assert.ok(boundary?.type === "frame");
  assert.equal(boundary.type, "frame");
  assert.equal(boundary.kind, "architecture-system-boundary");
  assert.deepEqual(
    boundary.statements.filter((item) => item.type === "node").map((item) => item.kind),
    [
      "architecture-person",
      "architecture-system",
      "architecture-external-system",
      "architecture-container",
      "architecture-component",
      "architecture-database",
      "architecture-queue",
    ],
  );
});

test("architecture notation emits grouped editable Excalidraw primitives", () => {
  const drawing = compile(parseSource(SOURCE)).toJSON();
  const byId = new Map(drawing.elements.map((element) => [element.id, element]));
  const element = (id: string) => {
    const found = byId.get(id);
    assert.ok(found, `missing element ${id}`);
    return found;
  };

  assert.equal(element("platform").type, "frame");
  assert.equal(element("platform.customer:head").type, "ellipse");
  assert.equal(element("platform.customer:body-line").type, "line");
  assert.equal(element("platform.system:frame").strokeWidth, 3);
  assert.equal(element("platform.external:frame").strokeStyle, "dashed");
  assert.equal(element("platform.api:tab-1").type, "rectangle");
  assert.equal(element("platform.orders:top").type, "ellipse");
  assert.equal(element("platform.orders:body-shape").type, "rectangle");
  assert.equal(element("platform.events:message-3").type, "rectangle");

  for (const id of [
    "platform.customer:head",
    "platform.system:frame",
    "platform.api:tab-1",
    "platform.orders:top",
    "platform.events:message-1",
  ]) {
    assert.equal(element(id).frameId, "platform");
  }
});

test("connectors bind to composite architecture frames", () => {
  const drawing = compile(parseSource(SOURCE)).toJSON();
  const arrows = drawing.elements.filter((element) => element.type === "arrow");
  assert.equal(arrows.length, 5);
  const bindings = arrows.flatMap((arrow) => [arrow.startBinding?.elementId, arrow.endBinding?.elementId]);
  for (const id of [
    "platform.customer:frame",
    "platform.system:frame",
    "platform.external:frame",
    "platform.web:frame",
    "platform.api:frame",
    "platform.orders:frame",
    "platform.events:frame",
  ]) {
    assert.ok(bindings.includes(id), `${id} should participate in a connector binding`);
  }
});

test("architecture metadata stays semantic and renders inside the card", () => {
  const document = parseSource(SOURCE);
  const platform = document.statements.find((item) => item.id === "platform");
  assert.ok(platform?.type === "frame");
  const web = platform.statements.find((item) => item.id === "platform.web");
  assert.ok(web?.type === "node");
  assert.equal(web.attributes.description, undefined);
  assert.equal(web.attributes.technology, undefined);
  const bodyStatement = web.statements.find((item) => item.type === "body");
  assert.equal(bodyStatement?.type === "body" ? bodyStatement.value : undefined, "Serves the customer experience");
  const technology = web.statements.find((item) => item.type === "property" && item.key === "technology");
  assert.equal(
    technology?.type === "property" ? technology.value : undefined,
    "TypeScript",
  );

  const drawing = compile(document).toJSON();
  const frame = requireElementById(drawing.elements, "platform.web:frame");
  const title = requireElementById(drawing.elements, "platform.web:title") as TextElement;
  const kind = requireElementById(drawing.elements, "platform.web:kind") as TextElement;
  const body = requireElementById(drawing.elements, "platform.web:body") as TextElement;
  assert.match(kind.text, /\[Container \| TypeScript\]/u);
  assert.ok(title.y < kind.y && kind.y < body.y);
  assert.ok(body.y + body.height <= frame.y + frame.height);
});

test("architecture boundaries communicate distinct scopes", () => {
  const drawing = compile(parseSource(SOURCE)).toJSON();
  const byId = new Map(drawing.elements.map((element) => [element.id, element]));
  const frame = (id: string): FrameElement => {
    const element = byId.get(id);
    assert.ok(element?.type === "frame", `missing frame ${id}`);
    return element;
  };
  assert.equal(frame("platform").strokeStyle, "solid");
  assert.equal(frame("internals").strokeStyle, "dashed");
  assert.equal(frame("runtime").strokeWidth, 3);
  assert.equal(frame("domain").strokeStyle, "dotted");
  assert.match(frame("platform").name ?? "", /^Software System:/u);
  assert.match(frame("internals").name ?? "", /^Container:/u);
  assert.match(frame("runtime").name ?? "", /^Deployment Node:/u);
  assert.match(frame("domain").name ?? "", /^Group:/u);
  assert.equal(isArchitectureBoundaryKind("architecture-container-boundary"), true);
  assert.equal(isArchitectureBoundaryKind("architecture-container"), false);
});

test("architecture glyphs stay inside explicitly compact cards", () => {
  const document = parseSource(`
    use "xdraw/architecture" as arch
    diagram "Compact" {
      component: arch.component "Worker" {
        description = "Runs work"
        technology = "TypeScript"
      }
      queue: arch.queue "Jobs" {
        description = "Buffers work"
        technology = "Kafka"
      }
    }
  `);
  const [component, queue] = document.statements.filter((item) => item.type === "node");
  assert.ok(component?.type === "node" && queue?.type === "node");
  for (const { node, bounds } of [
    { node: component, bounds: { x: 20, y: 30, width: 100, height: 56 } },
    { node: queue, bounds: { x: 180, y: 30, width: 100, height: 56 } },
  ] satisfies { node: NodeStatement; bounds: { x: number; y: number; width: number; height: number } }[]) {
    const decorations = renderArchitectureNode(node, bounds).filter(
      (element) => /:(?:tab|message)-/u.test(element.id),
    );
    assert.ok(decorations.length > 0);
    for (const element of decorations) {
      assert.ok(element.x >= bounds.x && element.y >= bounds.y);
      assert.ok(element.x + element.width <= bounds.x + bounds.width);
      assert.ok(element.y + element.height <= bounds.y + bounds.height);
    }
  }
});

test("relationship technology is rendered with the measured label", () => {
  const drawing = compile(parseSource(SOURCE)).toJSON();
  const relationship = drawing.elements.find(
    (element) => element.type === "text" && element.text?.includes("[SQL]"),
  );
  assert.ok(relationship?.type === "text");
  assert.match(relationship.text, /reads orders\n\[SQL\]/u);
});

test("architecture guidance is advisory and complete declarations are quiet", () => {
  const complete = compile(parseSource(SOURCE));
  assert.deepEqual(complete.diagnostics.filter((item) => item.code.startsWith("XD21")), []);

  const incomplete = compile(parseSource(`
    use "xdraw/architecture" as arch
    diagram "Incomplete architecture" {
      area: arch.system-boundary "Area" {
        arrange row { gap = 80 }
        source: arch.container "Source"
        target: arch.database "Target"
        source -> target
      }
    }
  `));
  assert.deepEqual(
    incomplete.diagnostics.filter((item) => item.code.startsWith("XD21")).map((item) => item.code),
    ["XD2101", "XD2102", "XD2101", "XD2102", "XD2103", "XD2104"],
  );
  assert.ok(incomplete.diagnostics.every((item) => item.severity === "warning"));
});

test("runtime relationships independently request a protocol", () => {
  const result = compile(parseSource(`
    use "xdraw/architecture" as arch
    diagram "Runtime relationship" {
      source: arch.container "Source" {
        description = "Sends work"
        technology = "Node.js"
      }
      target: arch.queue "Target" {
        description = "Buffers work"
        technology = "Kafka"
      }
      source@east -> target@west "publishes"
    }
  `));
  assert.deepEqual(
    result.diagnostics.filter((item) => item.code.startsWith("XD21")).map((item) => item.code),
    ["XD2104"],
  );
});

test("nodes reject ambiguous body and description content", () => {
  assert.throws(() => parseSource(`
    diagram "Ambiguous" {
      item: rectangle "Item" { body = "A"; description = "B" }
    }
  `), /may use body or description, not both/u);
});
