// math.plot lowers to a freedraw whose points the compiler works out from a
// pair of expressions. The accuracy of those points is the curve sampler's
// contract and is tested in test/curve-sampler.test.ts; what matters here is
// that the constructor is wired correctly — that it reaches the sampler, that
// its curve-describing properties do not leak into the style pass, and that a
// curve which cannot be drawn fails when the document is read.
import assert from "node:assert/strict";
import test from "node:test";

import { compile, parse } from "../src/index.ts";
import { renderSceneSvg } from "../src/io/local-renderer.ts";

const TAU = 6.283185307179586;

interface FreedrawElement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  fillStyle: string;
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
    x = 120 * sin(2*t)
    y = 110 * sin(3*t)
    domain (0, tau)
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
      x = 1 / t
      y = t
      domain (0, 3)
    }
  }`);
  assert.throws(() => stroke(withPole), /plot 'mark' could not be drawn/, "a pole must be reported");

  const tooLarge = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x = t * 2000000
      y = t
      domain (0, 1)
    }
  }`);
  assert.throws(() => stroke(tooLarge), /could not be drawn.*beyond the limit of/s);
});

test("a plot is positioned at its `at` property", () => {
  const mark = stroke(withImport(`diagram "" {
    mark: math.plot {
      at (300, 200)
      x = 50 * cos(t)
      y = 50 * sin(t)
      domain (0, tau)
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
  for (const missing of ["x", "y", "domain", "at"]) {
    const properties = new Map([
      ["at", "at (0, 0)"],
      ["x", 'x = t'],
      ["y", 'y = t'],
      ["domain", "domain (0, 1)"],
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

test("a domain end may be a constant as well as a number", () => {
  // The point of the interval kind: a full turn reads as `tau` rather than as
  // 6.283185307179586. The constants are the expression sublanguage's, so the
  // two cannot drift apart.
  const byConstant = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = 50 * cos(t); y = 50 * sin(t); domain (0, tau) }
  }`));
  const byNumber = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = 50 * cos(t); y = 50 * sin(t); domain (0, ${TAU}) }
  }`));
  assert.deepEqual(byConstant.points, byNumber.points, "tau and its value must agree exactly");

  const half = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = 50 * cos(t); y = 50 * sin(t); domain (0, pi) }
  }`));
  assert.ok(half.points.length < byConstant.points.length, "half a turn needs fewer points than a whole one");
});

test("a domain rejects what is not a number or a known constant", () => {
  const domain = (text: string) => withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = t; y = t; domain ${text} }
  }`);
  assert.throws(() => stroke(domain("(0, wobble)")), /domain|interval/i, "an unknown name must be rejected");
  assert.throws(() => stroke(domain('(0, "1")')), /domain|interval/i, "a string must be rejected");
  assert.throws(() => stroke(domain("(0, 1, 2)")), /domain|interval/i, "three ends must be rejected");
  assert.throws(() => stroke(domain("5")), /domain|interval/i, "a bare number must be rejected");
});

test("an expression is written as an equation, not as a string", () => {
  const quoted = withImport(`diagram "" {
    mark: math.plot { at (0, 0); x "60 * cos(t)"; y = 60 * sin(t); domain (0, tau) }
  }`);
  assert.throws(() => stroke(quoted), /expects expression, received string/, "a quoted expression must be rejected");
});

test("an expression ends where the grammar ends it, without a delimiter", () => {
  // This is what makes an unquoted expression possible: after a complete term
  // only an operator can continue it, so the next property name finishes it.
  // Nothing is delimited, and no newline is significant.
  const oneLine = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = 60 * cos(t); y = 60 * sin(t); domain (0, tau); stroke "#111111" }
  }`));
  const manyLines = stroke(withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x = 60 * cos(t)
      y = 60 * sin(t)
      domain (0, tau)
      stroke "#111111"
    }
  }`));
  assert.deepEqual(oneLine.points, manyLines.points, "line breaks must not change meaning");
  assert.equal(oneLine.strokeColor, "#111111", "the property after an expression must still be read");
});

test("a minus keeps its meaning inside an expression", () => {
  // The document tokenizer folds a leading minus into the number that follows,
  // so `90-30` reads as two numbers there. Expressions are read by their own
  // tokenizer, which is why this stays a subtraction rather than silently
  // becoming the first operand alone.
  const flat = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = 50 * t; y = 90 - 30; domain (0, 2) }
  }`));
  assert.equal(Math.round(flat.height), 0, "y = 90 - 30 is constant, so the curve is flat");
  const descending = stroke(withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = t; y = 0 - t; domain (0, 100) }
  }`));
  assert.equal(Math.round(descending.height), 100);
});

test("a mistake after '=' says what the mistake was", () => {
  // The expression parser reports what its own grammar saw, which after '=' is
  // usually "unexpected end of expression" — true, and no help in finding the
  // problem. These are the three ways an author is likely to get it wrong.
  const document = (property: string) => withImport(`diagram "" {
    mark: math.plot { at (0, 0); ${property}; y = t; domain (0, 1) }
  }`);
  assert.throws(() => parse(document('x "60 * cos(t)"')), /expects expression, received string/);
  assert.throws(() => parse(document('x = "60 * cos(t)"')), /written after '=' without quotes/);
  assert.throws(() => parse(document("x = ")), /expected an expression after '='/);
  assert.throws(() => parse(document("x = = t")), /expected an expression after '='/);
  // A genuine syntax error inside a well-formed expression must still report
  // itself rather than being flattened into the generic message.
  assert.throws(() => parse(document("x = sin(t")), /expected '\)'/);
});

test("a template parameter reaches a plot's equations", () => {
  // A plot is described rather than drawn when the document is read, so a
  // parameter is still text when the expander substitutes it. Sampling in the
  // parser made this impossible: the curve was frozen before the template ran.
  const source = withImport(`diagram "" {
    petal: template(amp, freq) {
      curve: math.plot {
        at (0, 0)
        x = ${"$"}{amp} * cos(${"$"}{freq} * t) * cos(t)
        y = ${"$"}{amp} * cos(${"$"}{freq} * t) * sin(t)
        domain (0, tau)
      }
    }
    small: petal (40, 3)
    large: petal (90, 3)
  }`);
  const scene = compile(parse(source)).toJSON();
  const strokes = scene.elements.filter((e) => e.type === "freedraw");
  assert.equal(strokes.length, 2, "one stroke per use of the template");
  // Both uses have the same petal count, so width scales with amp alone and the
  // ratio proves each use was drawn from its own parameter rather than sharing.
  const [small, large] = strokes as unknown as Array<{ width: number }>;
  assert.ok(
    Math.abs(large.width / small.width - 90 / 40) < 0.02,
    `widths ${small.width} and ${large.width} do not scale with amp`,
  );
});

test("a parameter no template supplies is reported, not passed to the sampler", () => {
  const orphan = withImport(`diagram "" {
    mark: math.plot { at (0, 0); x = ${"$"}{amp} * t; y = t; domain (0, 1) }
  }`);
  assert.throws(() => compile(parse(orphan)), /'\$\{amp\}' is not supplied by any template/);
});

test("a plot may be placed from another element's measured geometry", () => {
  // A plot becomes a freehand stroke, and freehand may be placed that way — so
  // this ought to have worked. It did not: the plot pass added the sample
  // origin to an `at` that was still text, concatenating a string with a
  // number and producing `'flow.a.center_y60'`.
  const source = withImport(`diagram "" {
    flow: frame "F" {
      arrange row { gap 40 }
      a: rectangle "A"
      b: rectangle "B"
    }
    mark: math.plot {
      at = (flow.a.right + 40, flow.a.center_y)
      x = 60 * cos(t)
      y = 60 * sin(t)
      domain (0, tau)
    }
  }`);
  const scene = compile(parse(source)).toJSON();
  const box = scene.elements.find((e) => e.id === "flow.a:frame");
  const mark = scene.elements.find((e) => e.id === "mark:stroke");
  assert.ok(box && mark, "both must be drawn");
  const referenced = box as unknown as { x: number; y: number; width: number; height: number };
  const curve = mark as unknown as { x: number; y: number; width: number; height: number };
  // The curve is a circle of radius 60 centred on the resolved point, so its
  // left edge sits 60 to the left of that point.
  assert.equal(Math.round(curve.x + curve.width / 2), Math.round(referenced.x + referenced.width + 40));
  assert.equal(Math.round(curve.y + curve.height / 2), Math.round(referenced.y + referenced.height / 2));
});

test("a plot may sit inside a container", () => {
  // A plot lowers to a freedraw, which every container already accepts, but the
  // child policy is checked against the declared semantic kind rather than what
  // it lowers to — so `plot` had to be listed too. Without it, nesting a curve
  // in a frame failed with "constructor 'frame' does not accept child kind".
  for (const container of ["frame", "group", "section"]) {
    const source = withImport(`diagram "" {
      panel: ${container} "Panel" {
        mark: math.plot { at (0, 0); x = 50 * cos(t); y = 50 * sin(t); domain (0, tau) }
      }
    }`);
    assert.doesNotThrow(() => compile(parse(source)), `a plot must nest inside a ${container}`);
  }
});

test("a plot rejects an expression outside the sublanguage", () => {
  const source = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x = wobble(t)
      y = t
      domain (0, 1)
    }
  }`);
  assert.throws(() => stroke(source), /unknown function 'wobble'/);

  const freeName = withImport(`diagram "" {
    mark: math.plot {
      at (0, 0)
      x = a * t
      y = t
      domain (0, 1)
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

test("a closed curve can be filled", () => {
  // `freedraw` has accepted `background` and `fill-style` all along, and a plot
  // lowers to exactly that element, so withholding them at the constructor kept
  // a shaded region out of reach: the area under a curve, a feasible region, a
  // phase-space basin.
  const element = stroke(withImport(lissajous('background "#c7d2fe"\n    fill-style solid')));
  assert.equal(element.backgroundColor, "#c7d2fe");
  assert.equal(element.fillStyle, "solid");

  // The hatch styles come along, because they were already in the palette.
  for (const style of ["hachure", "cross-hatch"]) {
    assert.doesNotThrow(
      () => stroke(withImport(lissajous(`background "#fecaca"\n    fill-style ${style}`))),
      `fill-style ${style} should be accepted`,
    );
  }

  // An unfilled plot keeps drawing as it did.
  assert.equal(stroke(withImport(lissajous())).backgroundColor, "transparent");
});

test("a filled closed curve reaches the rendered image, not just the JSON", () => {
  // Asserting backgroundColor on the element was not enough: the local renderer
  // drew a freedraw as its outline alone, so every preview this repository
  // produces showed an empty ring while the JSON claimed a fill.
  const closed = `diagram "Filled" {
    ring: freedraw {
      at (200, 200)
      points ((0,0),(100,0),(100,100),(0,100),(0,0))
      background "#c7d2fe"
    }
  }`;
  assert.match(renderSceneSvg(compile(parse(closed)).toJSON()), /c7d2fe/u);

  // An open stroke with a fill no longer compiles at all, so there is no case
  // left where a document claims a fill and gets none: XD1228 covers it, and
  // test/semantic-diagnostics.test.ts asserts that. A stroke that closes within
  // the 8px Excalidraw allows does fill.
  const nearlyClosed = `diagram "Nearly" {
    ring: freedraw {
      at (200, 200)
      points ((0,0),(100,0),(100,100),(0,100),(0,5))
      background "#fde68a"
    }
  }`;
  assert.match(renderSceneSvg(compile(parse(nearlyClosed)).toJSON()), /fde68a/u);
});
