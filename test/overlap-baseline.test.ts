import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { collectInvariant, compiledSourceFiles } from "../test-support/invariant-baseline.ts";

interface Baseline { accepted: Record<string, readonly string[]> }

const baseline = JSON.parse(await readFile("corpus/overlap.json", "utf8")) as Baseline;

test("unexpected scene overlaps match the reviewed baseline exactly", async () => {
  const observed = await collectInvariant("XD3002", (item) => item.subjects?.join(" <> "));
  const expected = Object.fromEntries(
    Object.entries(baseline.accepted).map(([file, subjects]) => [file, [...subjects].sort()]),
  );
  assert.deepEqual(
    observed,
    expected,
    "overlaps differ from corpus/overlap.json; fix new findings and remove stale accepted entries",
  );
});

test("every accepted overlap belongs to a compiled source", async () => {
  const compiled = new Set(await compiledSourceFiles());
  for (const file of Object.keys(baseline.accepted)) assert.ok(compiled.has(file), `${file} is not compiled`);
});
