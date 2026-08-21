import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SemanticStatement } from "../src/contracts/semantic.ts";
import { parseSource } from "../src/language/parser.ts";
import { analyzeRelativeCoordinate } from "../src/language/relative-position.ts";

interface PlacementCounts {
  automaticNodes: number;
  absoluteNodes: number;
  relativeNodes: number;
  absoluteDetached: number;
  relativeDetached: number;
  computedDetached: number;
}

interface AdoptionEntry {
  file: string;
  task: string;
  expected: PlacementCounts;
  remainingAbsoluteIntent: string;
}

interface AdoptionBaseline {
  schemaVersion: number;
  method: string;
  sources: AdoptionEntry[];
}

const baseline = JSON.parse(
  await readFile("corpus/placement-adoption.json", "utf8"),
) as AdoptionBaseline;

function blankCounts(): PlacementCounts {
  return {
    automaticNodes: 0,
    absoluteNodes: 0,
    relativeNodes: 0,
    absoluteDetached: 0,
    relativeDetached: 0,
    computedDetached: 0,
  };
}

function isGeometryRelative(at: readonly unknown[]): boolean {
  try {
    return at.some((coordinate) => (
      (typeof coordinate === "number" || typeof coordinate === "string")
      && analyzeRelativeCoordinate(coordinate).terms.length > 0
    ));
  } catch {
    return false;
  }
}

function countPlacements(statements: readonly SemanticStatement[], counts = blankCounts()): PlacementCounts {
  for (const statement of statements) {
    const at = statement.at as unknown;
    if (statement.type === "node") {
      if (at === undefined) counts.automaticNodes += 1;
      else if (Array.isArray(at) && isGeometryRelative(at)) counts.relativeNodes += 1;
      else counts.absoluteNodes += 1;
    } else if (["text", "freedraw", "plot"].includes(statement.type) && Array.isArray(at)) {
      if (isGeometryRelative(at)) counts.relativeDetached += 1;
      else if (at.every((coordinate) => typeof coordinate === "number")) counts.absoluteDetached += 1;
      else counts.computedDetached += 1;
    }
    if (statement.statements) countPlacements(statement.statements, counts);
  }
  return counts;
}

test("placement adoption is evaluated from authored tasks, not prior feature usage", async () => {
  assert.equal(baseline.schemaVersion, 1);
  assert.match(baseline.method, /before counting/u);
  assert.ok(baseline.sources.length >= 2);

  let relative = 0;
  let absolute = 0;
  for (const entry of baseline.sources) {
    assert.ok(entry.task.length > 0);
    assert.ok(entry.remainingAbsoluteIntent.length > 0);
    const source = await readFile(entry.file, "utf8");
    const actual = countPlacements(parseSource(source).statements);
    assert.deepEqual(actual, entry.expected, entry.file);
    relative += actual.relativeNodes + actual.relativeDetached;
    absolute += actual.absoluteNodes + actual.absoluteDetached;
  }
  assert.ok(relative > absolute, "selected relationship tasks should derive more positions than they guess");
});
