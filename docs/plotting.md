# Plotting curves

`math.plot` draws a parametric curve from a pair of expressions in `t`. The
result is an ordinary freehand stroke: movable, resizable, and editable point by
point like anything else on the canvas.

```xdraw
use "xdraw/math" as math

diagram "Plot" {
  mark: math.plot {
    at (200, 200)
    x """120 * sin(2*t)"""
    y """110 * sin(3*t)"""
    from 0
    to 6.283185307179586
    stroke "#4d7c0f"
  }
}
```

## What it can draw

![Three parametric curves: a butterfly, a damped harmonograph, and a decaying wave](images/parametric-plots.png)

Nothing above is a special case in the compiler. Each is the same constructor
with different expressions:

```
butterfly     x = 40·sin(t)·(e^cos(t) − 2·cos(4t) − sin(t/12)^5)
              y = 40·cos(t)·(…)                     over 0 … 12π

harmonograph  x = 115·sin(3t)·e^(−t/60)
              y = 115·sin(2t + 1)·e^(−t/60)         over 0 … 22

wave          x = 12t
              y = 70·sin(t)·e^(−t/14)               over 0 … 40
```

The full source is in
[`examples/parametric-plots.xdraw`](../examples/parametric-plots.xdraw).

## The vocabulary

Expressions are a closed sublanguage, not general-purpose code. There is no
assignment, no control flow, no property access, and one variable.

| | |
|---|---|
| variable | `t` |
| operators | `+` `-` `*` `/` `^`, and parentheses |
| constants | `pi`, `tau`, `e` |
| functions | `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sqrt` `abs` `sign` `floor` `ceil` `round` `min` `max` `exp` `log` `hypot` |

`^` is right-associative and binds tighter than unary minus, so `-2^2` is `-4`
and `2^3^2` is `512` — as they read on paper.

Anything outside that vocabulary is rejected when the document is read, with the
position of the problem:

```
t = 4          rejected at 2: unexpected character '='
sin(t          rejected at 5: expected ')'
foo.bar(t)     rejected at 3: malformed number
```

## Tolerance is a guarantee, not a target

`tolerance` is the greatest distance the drawn line may fall from the true
curve, in pixels. It defaults to `0.5`.

![The same rose at tolerance 16, 3, and 0.5 — petals collapse at the coarsest](images/plot-tolerance.png)

The same three-petal rose, drawn three times. At a 16px tolerance the petals
collapse into a scrawl; at 0.5px they are full. The compiler spends points where
the curve bends and none where it does not — 21 points, then 65, then 129.

The word *guarantee* is meant literally. The compiler does not sample the curve
at some points and hope the rest behaves; it bounds each span of the curve and
subdivides until the bound fits inside the tolerance. A curve of high frequency
cannot slip between the samples, because there are no samples to slip between.

## What it refuses, and why

A curve the compiler cannot draw within its tolerance is refused while the
document is being read, alongside every other language error. It is never
approximated and never silently wrong.

```
x = 1 / t,  0 … 3
  the curve is not finite at t = 0

x = tan(t),  0 … 4
  the curve is unbounded between t = 1.500 and t = 2.000

x = sqrt(abs(t)) / cos(2*t),  0 … 2
  the curve is unbounded between t = 0.7500 and t = 1.000

x = exp(t),  0 … 19
  the curve reaches 1.544e+6 between t = 11.88 and t = 14.25,
  beyond the limit of 1000000

x = wobble(t)          unknown function 'wobble'
x = a * t              unknown name 'a'
x = sin(t, t)          sin takes 1 argument, received 2
```

The third is the interesting one. Both `sqrt(abs(t))` and `cos(2t)` are
perfectly well behaved; dividing one by the other introduces a pole that neither
has on its own. Nothing about the shape of the expression gives it away, and
sampling near it is a matter of luck. The compiler finds it because dividing by
a range that contains zero produces an unbounded range — the pole is a
consequence of the arithmetic rather than something to be detected.

## Composing with the rest of the language

A plot is a stroke, so it sits alongside anything else in a document:

```xdraw
use "xdraw/math" as math

diagram "Composition" {
  flow: frame "A plot is an ordinary stroke once compiled" {
    arrange row { gap 60 }
    input: rectangle "Expression"
    output: rectangle "Editable stroke"
    input -> output "sampled"
  }

  curve: math.plot {
    at (330, 420)
    x """90 * sin(2*t)"""
    y """70 * sin(3*t)"""
    from 0
    to 6.283185307179586
    stroke "#7c3aed"
  }
}
```

Plots are placed with `at` rather than by layout, because a curve's position is
part of what the expressions mean. Everything else in the document arranges
normally around them.

## Limits worth knowing

- **`from` and `to` are numbers, not expressions.** A full turn has to be
  written as `6.283185307179586` rather than `tau`.
- **A closed curve shows a faint seam** where its start and end meet, because
  the stroke has ends even when the curve does not.
- **Fidelity is bounded on the emitted points, not on the rendered stroke.**
  Excalidraw smooths freehand strokes when drawing them, which generally flatters
  a coarse curve rather than harming it.
- **A curve that crosses the negative x axis through `atan2`** has a genuine
  jump there, and the stroke will cross the gap with a straight segment.
- **Expressions are bounded in size** — at most 512 terms and 64 levels of
  nesting — so a generated document cannot exhaust the compiler.

## Where it lives

`math.plot` is declared in the `xdraw/math` library alongside `math.formula`.
The expression sublanguage is
[`src/language/expression.ts`](../src/language/expression.ts), the bounding
arithmetic is [`src/language/interval.ts`](../src/language/interval.ts), and the
sampler that turns a curve into points is
[`src/language/curve-sampler.ts`](../src/language/curve-sampler.ts). See
[the architecture notes](architecture.md) for how those fit together.
