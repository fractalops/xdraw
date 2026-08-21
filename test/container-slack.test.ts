import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { collectInvariant, compiledSourceFiles } from "../test-support/invariant-baseline.ts";

interface Baseline {
  budget: number;
  accepted: Record<string, readonly string[]>;
}

const baseline: Baseline = JSON.parse(await readFile(path.join("corpus", "container-slack.json"), "utf8"));

test("no container reserves more space below its last child than the budget allows", async () => {
  const observed = await collectInvariant("XD3001", (item) => (
    (item.measures?.available ?? 0) - (item.measures?.required ?? 0) > baseline.budget
      ? item.subjects?.[0] ?? "?"
      : undefined
  ));
  const expected = Object.fromEntries(
    Object.entries(baseline.accepted).map(([file, ids]) => [file, [...ids].sort()]),
  );
  // Additions mean a new over-reservation shipped. Removals mean the list is
  // stale and claims a defect that is fixed, which is its own kind of wrong.
  assert.deepEqual(
    observed,
    expected,
    "container slack differs from corpus/container-slack.json; the list may only shrink."
      + ` Write this as its "accepted": ${JSON.stringify(observed, null, 2)}`,
  );
});

test("the budget admits a section's heading band and rejects the known defects", async () => {
  // 80 is not arbitrary: a section reserves 76px for a heading it draws, so a
  // lower budget would flag correct containers, and the smallest real defect is
  // 87. Pinning both edges keeps a future budget change deliberate.
  assert.ok(baseline.budget >= 76, "budget must admit a section's 76px heading band");
  assert.ok(baseline.budget < 87, "budget must still reject the smallest known over-reservation");
});

test("every accepted entry names a source that exists and is compiled", async () => {
  const compiled = new Set(await compiledSourceFiles());
  for (const file of Object.keys(baseline.accepted)) {
    assert.ok(compiled.has(file), `${file} is listed but is not among the compiled sources`);
  }
});
