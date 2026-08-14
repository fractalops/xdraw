import assert from "node:assert/strict";
import test from "node:test";

import { layoutGap, ROUTING_CLEARANCE, SPACING_PRESETS } from "../src/routing/clearances.ts";
import { createDiagnosticCollector, formatDiagnostic } from "../src/io/diagnostics.ts";
import { splitEndpoint } from "../src/routing/endpoints.ts";
import { nonceFor, seedFor, stableHash } from "../src/identity.ts";

test("diagnostics retain locations and suppress exact duplicates", () => {
  const collector = createDiagnosticCollector();
  const node = {
    sourceFile: "diagram.xdraw",
    span: { start: { line: 4, column: 7 } },
  };

  const first = collector.error("XD1001", "Invalid declaration", node);
  collector.error("XD1001", "Invalid declaration", node);
  const warning = collector.warn("XD2001", "Automatic correction applied");

  assert.equal(collector.diagnostics.length, 2);
  assert.equal(formatDiagnostic(first), "XD1001: Invalid declaration at diagram.xdraw:4:7");
  assert.equal(formatDiagnostic(warning), "XD2001: Automatic correction applied");
});

test("identity values are deterministic non-zero unsigned integers", () => {
  assert.equal(stableHash("node"), stableHash("node"));
  assert.equal(seedFor("node"), seedFor("node"));
  assert.notEqual(seedFor("node", "seed"), seedFor("node", "other"));

  for (const value of [stableHash("node"), seedFor("node"), nonceFor("node")]) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= 0 && value <= 0xffffffff, true);
  }
  assert.notEqual(seedFor("node"), 0);
});

test("endpoint aliases preserve known dotted IDs and ignore inherited names", () => {
  const known = new Set(["service.right"]);

  assert.deepEqual(splitEndpoint("service.right", known), { id: "service.right", side: undefined });
  assert.deepEqual(splitEndpoint("service.east"), { id: "service", side: "right" });
  assert.deepEqual(splitEndpoint("service.center"), { id: "service", side: "center" });
  assert.deepEqual(splitEndpoint("service.toString"), { id: "service.toString", side: undefined });
  assert.deepEqual(splitEndpoint("service"), { id: "service", side: undefined });
});

test("layout gaps prefer explicit values and resolve every spacing preset", () => {
  assert.equal(layoutGap({ gap: 0, spacing: "airy" }, 99), 0);
  assert.equal(layoutGap(null, 99), 99);

  for (const [spacing, gap] of Object.entries(SPACING_PRESETS)) {
    assert.equal(layoutGap({ spacing }, 99), gap);
  }

  assert.deepEqual(ROUTING_CLEARANCE, {
    endpoint: 20,
    obstacle: 12,
    channel: 16,
    label: 8,
  });
});
