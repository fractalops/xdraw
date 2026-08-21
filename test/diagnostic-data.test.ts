import assert from "node:assert/strict";
import test from "node:test";

import { compilePrepared as compile } from "../src/compile/pipeline.ts";
import { formatDiagnostic } from "../src/io/diagnostics.ts";
import { parseSource } from "../src/language/parser.ts";
import type { Diagnostic } from "../src/contracts/foundation.ts";

function diagnose(source: string): Diagnostic[] {
  return [...compile(parseSource(source)).diagnostics];
}

function one(source: string, code: string): Diagnostic {
  const found = diagnose(source).filter((item) => item.code === code);
  assert.equal(found.length, 1, `expected exactly one ${code}, got ${found.map((f) => f.code).join(", ")}`);
  return found[0];
}

const RAISED_GAP = `diagram "gap" {
  lane: frame "Lane" {
    arrange column { gap = 10 }
    one: rectangle "One" { size = (300, 90) }
    two: rectangle "Two" { size = (300, 90) }
    one@south -> two@north "waits for the first to finish"
  }
}`;

const OVERFLOWING_CODE = `diagram "code" {
  arrange grid { columns = 4; gap = 40 }
  a: section "A" {
    arrange column { gap = 20 }
    wide: code """
      this line is deliberately far too long to fit inside a narrow grid column at all
    """ { title = "t"; language = xdraw; line-numbers = false }
  }
  b: section "B" { arrange column { gap = 20 }; x: rectangle "x" }
  c: section "C" { arrange column { gap = 20 }; y: rectangle "y" }
  d: section "D" { arrange column { gap = 20 }; z: rectangle "z" }
}`;

const UNEVEN_ROW = `diagram "heights" {
  row: frame "Row" {
    arrange row { gap = 120 }
    short: rectangle "Short" { size = (200, 80) }
    tall: rectangle "Tall" { size = (200, 200) }
    short@east -> tall@west
  }
}`;

test("a raised gap reports the value asked for and the value used", () => {
  const item = one(RAISED_GAP, "XD2001");
  assert.equal(item.measures?.requested, 10);
  assert.equal(item.measures?.resolved, 66);
  // The prose already carried both numbers; the point is that a consumer no
  // longer has to parse the sentence to get them.
  assert.match(item.message, /gap 10 was raised to 66/u);
});

test("an overflowing code block reports what it needed as well as what it had", () => {
  const item = one(OVERFLOWING_CODE, "XD2005");
  assert.equal(typeof item.measures?.required, "number");
  assert.equal(typeof item.measures?.available, "number");
  // `required` is the number the old message never carried, and the only one
  // that says how much wider the column would have to be.
  const { required = 0, available = 0 } = item.measures ?? {};
  assert.ok(required > available, `required ${required} should exceed available ${available}`);
  assert.deepEqual(item.subjects, ["a.wide"]);
});

test("an uneven row names its two elements and offers an applicable statement", () => {
  const item = one(UNEVEN_ROW, "XD2006");
  assert.deepEqual(item.subjects, ["row.short", "row.tall"]);
  assert.equal(item.suggestion, "match-size (row.short, row.tall) height");
});

test("a suggestion is source a document can accept unchanged", () => {
  const item = one(UNEVEN_ROW, "XD2006");
  const repaired = UNEVEN_ROW.replace("    short@east -> tall@west", `    short@east -> tall@west\n    ${item.suggestion}`);
  const codes = diagnose(repaired).map((entry) => entry.code);
  assert.ok(!codes.includes("XD2006"), `applying the suggestion should clear XD2006, got ${codes.join(", ")}`);
});

test("structured fields do not change rendered output", () => {
  assert.equal(
    formatDiagnostic(one(RAISED_GAP, "XD2001")),
    "XD2001: layout gap 10 was raised to 66 so connector labels fit at 3:5",
  );
});

test("each diagnostic carries its own measures rather than a shared object", () => {
  const items = diagnose(`diagram "two" {
  first: frame "First" {
    arrange column { gap = 10 }
    a: rectangle "A" { size = (300, 90) }
    b: rectangle "B" { size = (300, 90) }
    a@south -> b@north "waits for the first to finish"
  }
  second: frame "Second" {
    arrange column { gap = 12 }
    c: rectangle "C" { size = (300, 90) }
    d: rectangle "D" { size = (300, 90) }
    c@south -> d@north "waits for the first to finish"
  }
}`).filter((item) => item.code === "XD2001");
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.measures?.requested), [10, 12]);
});

test("a diagnostic with no numbers still names the element it is about", () => {
  const item = one(`use "xdraw/architecture" as arch
diagram "arch" {
  api: arch.component "API" { description = "does a thing" }
}`, "XD2102");
  assert.deepEqual(item.subjects, ["api"]);
  assert.equal(item.measures, undefined);
  assert.equal(item.suggestion, undefined);
});
