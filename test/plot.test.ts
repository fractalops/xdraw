// math.plot lowers to a freedraw whose points the compiler works out from a
// pair of expressions. The accuracy of those points is the curve sampler's
// contract and is tested in test/curve-sampler.test.ts; what matters here is
// that the constructor is wired correctly — that it reaches the sampler, that
// its curve-describing properties do not leak into the style pass, and that a
// curve which cannot be drawn fails when the document is read.
import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";

const TAU = 6.283185307179586;

interface FreedrawElement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  points: Array<[number, number]>;
  pressures: number[];
  simulatePressure: boolean;
}

function stroke(source: string): FreedrawElement {
  const scene = compile(parse(source)).toJSON();
  const element = scene.elements.find((candidate) => candidate.id === "mark:stroke");
  assert.ok(element, "the plot must compile to an element named 'mark:stroke'");
  return element as unknown as FreedrawElement;
}

const lissajous = (extra = "") => `diagram "" {
  mark: math.plot {
    at (100, 80)
    x """120 * sin(2*t)"""
    y """110 * sin(3*t)"""
    from 0
    to ${TAU}
    ${extra}
  }
}`;
const withImport = (body: string) => `use "xdraw/math" as math\n\n${body}`;

test("a plot compiles to an editable freehand element", () => {
  const mark = stroke(withImport(lissajous(`stroke "#4d7c0f"
    stroke-width 3`)));

  assert.equal(mark.type, "freedraw", "a plot is a freedraw once compiled");
  // The amplitudes are 120 and 110, so the curve spans 240 by 220 whatever the
  // sampling density turns out to be.
  assert.equal(Math.round(mark.width), 240);
  assert.equal(Math.round(mark.height), 220);
  assert.equal(mark.strokeColor, "#4d7c0f");
  assert.equal(mark.strokeWidth, 3);
  assert.deepEqual(mark.pressures, []);
  assert.equal(mark.simulatePressure, false, "a plotted curve is not a pressure-varied stroke");
  assert.ok(mark.points.length > 32, `a closed Lissajous needs many points, got ${mark.points.length}`);
  // Points are normalised against the element's bounding box, so they start at
  // the origin corner and reach exactly the element's width and height.
  const xs = mark.points.map(([x]) => x);
  const ys = mark.points.map(([, y]) => y);
  assert.ok(Math.min(...xs) >= 0 && Math.min(...ys) >= 0, "no point sits outside the element");
  assert.equal(Math.round(Math.max(...xs)), Math.round(mark.width));
  assert.equal(Math.round(Math.max(...ys)), Math.round(mark.height));
  // The curve is closed, so it must return to where it began.
  const [firstX, firstY] = mark.points[0];
  const [lastX, lastY] = mark.points[mark.points.length - 1];
  assert.ok(Math.hypot(lastX - firstX, lastY - firstY) < 1, "a closed curve must return to its start");
});

test("the curve-describing properties do not reach the style pass", () => {
  // x, y, from, to and tolerance describe the curve rather than its appearance.
  // Left in the attribute bag they reach the style pass, which rejects any
  // attribute it does not recognise — "unsupported style property: x".
  assert.doesNotThrow(() => stroke(withImport(lissajous())));
  assert.doesNotThrow(() => stroke(withImport(lissajous("tolerance 2"))));
});

test("a finer tolerance produces a denser curve", () => {
  const coarse = stroke(withImport(lissajous("tolerance 4")));
  const fine = stroke(withImport(lissajous("tolerance 0.1")));
  assert.ok(
    fine.points.length > coarse.points.length,
    `tolerance 0.1 gave ${fine.points.length} points, tolerance 4 gave ${coarse.points.length}`,
  );
});

test("a curve that cannot be drawn fails when the document is read", () => {
  const withPole = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x """1 / t"""
      y """t"""
      from 0
      to 3
    }
  }`);
  assert.throws(() => stroke(withPole), /plot 'mark' could not be drawn/, "a pole must be reported");

  const tooLarge = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x """t * 2000000"""
      y """t"""
      from 0
      to 1
    }
  }`);
  assert.throws(() => stroke(tooLarge), /could not be drawn.*beyond the limit of/s);
});

test("a plot is positioned at its `at` property", () => {
  const mark = stroke(withImport(`diagram "" {
    mark: math.plot {
      at (300, 200)
      x """50 * cos(t)"""
      y """50 * sin(t)"""
      from 0
      to ${TAU}
    }
  }`));
  // The curve starts at (50, 0) relative to `at`, and spans 100 by 100 centred
  // on `at`, so its bounding box begins at (250, 150).
  assert.equal(Math.round(mark.width), 100);
  assert.equal(Math.round(mark.height), 100);
  assert.equal(Math.round(mark.x), 250);
  assert.equal(Math.round(mark.y), 150);
});

test("the language rejects a plot that is missing what it needs", () => {
  for (const missing of ["x", "y", "from", "to", "at"]) {
    const properties = new Map([
      ["at", "at (0, 0)"],
      ["x", 'x """t"""'],
      ["y", 'y """t"""'],
      ["from", "from 0"],
      ["to", "to 1"],
    ]);
    properties.delete(missing);
    const source = withImport(`diagram "" {
      mark: math.plot {
        ${[...properties.values()].join("\n        ")}
      }
    }`);
    assert.throws(() => stroke(source), new RegExp(missing), `a plot without '${missing}' must be rejected`);
  }
});

test("a plot rejects an expression outside the sublanguage", () => {
  const source = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x """wobble(t)"""
      y """t"""
      from 0
      to 1
    }
  }`);
  assert.throws(() => stroke(source), /unknown function 'wobble'/);

  const freeName = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x """a * t"""
      y """t"""
      from 0
      to 1
    }
  }`);
  assert.throws(() => stroke(freeName), /unknown name 'a'/);
});

test("plot is declared in the math library alongside formula", () => {
  const source = withImport(lissajous());
  assert.doesNotThrow(() => parse(source), "math.plot must resolve through the library import");
  assert.throws(
    () => parse(lissajous()),
    /unknown|import/i,
    "without the import it must not resolve",
  );
});
