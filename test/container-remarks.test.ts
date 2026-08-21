import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { parseSource } from "../src/language/parser.ts";
import type { Diagnostic } from "../src/contracts/foundation.ts";

const SECTION_WITH_GROUP = `diagram "containers" {
  arrange grid { columns = 2; gap = 24 }
  outer: section "Outer" {
    arrange column { gap = 18 }
    block: rectangle "Block" { size = (300, 100) }
    inner: group {
      arrange row { gap = 18 }
      left: rectangle "Left" { size = (140, 90) }
      right: rectangle "Right" { size = (140, 90) }
    }
  }
  plain: section "Plain" {
    arrange column { gap = 18 }
    only: rectangle "Only" { size = (300, 100) }
  }
}`;

function remarks(source: string, options: { remarks?: boolean } = {}): Diagnostic[] {
  return [...compile(parseSource(source), options).diagnostics].filter((item) => item.code === "XD3001");
}

function slack(item: Diagnostic): number {
  const { available = 0, required = 0 } = item.measures ?? {};
  return available - required;
}

function bySubject(items: Diagnostic[], id: string): Diagnostic {
  const found = items.filter((item) => item.subjects?.[0] === id);
  assert.equal(found.length, 1, `expected one remark for '${id}', got ${items.map((i) => i.subjects?.[0]).join(", ")}`);
  return found[0];
}

test("container remarks are silent unless asked for", () => {
  assert.deepEqual(remarks(SECTION_WITH_GROUP), []);
});

test("every container with placed children gets one remark", () => {
  const items = remarks(SECTION_WITH_GROUP, { remarks: true });
  const subjects = items.map((item) => item.subjects?.[0]).sort();
  assert.deepEqual(subjects, ["outer", "outer.inner", "plain"]);
});

test("a container remark reports what it reserved against what it used", () => {
  const item = bySubject(remarks(SECTION_WITH_GROUP, { remarks: true }), "outer");
  const { available, required } = item.measures ?? {};
  assert.equal(typeof available, "number");
  assert.equal(typeof required, "number");
  // The difference is the space left below the last child, which is the signal
  // the group defect shows up in.
  assert.ok((available ?? 0) >= (required ?? 0), `reserved ${available} should cover used ${required}`);
  assert.match(item.message, /reserved .*px and used .*px/u);
});

test("a remark is not a warning, so a consumer can filter it out", () => {
  const items = remarks(SECTION_WITH_GROUP, { remarks: true });
  assert.ok(items.length > 0);
  for (const item of items) assert.equal(item.severity, "remark");
});

test("a group reserves far more than it uses, and a section does not", () => {
  const items = remarks(SECTION_WITH_GROUP, { remarks: true });
  // Pins the finding the measurement spike turned up: the over-reservation
  // belongs to `group`, not to the section that encloses it.
  assert.ok(slack(bySubject(items, "outer.inner")) > 80, `group slack was ${slack(bySubject(items, "outer.inner"))}`);
  assert.ok(slack(bySubject(items, "plain")) <= 80, `section slack was ${slack(bySubject(items, "plain"))}`);
  assert.ok(slack(bySubject(items, "outer")) <= 80, `enclosing section slack was ${slack(bySubject(items, "outer"))}`);
});

test("remarks carry the source location of the container they describe", () => {
  const item = bySubject(remarks(SECTION_WITH_GROUP, { remarks: true }), "outer.inner");
  assert.equal(item.location?.line, 6);
});
