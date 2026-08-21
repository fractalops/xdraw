# XDraw language syntax

XDraw files describe editable diagrams. This page explains how the language is
written: the shape of a document, its declarations and properties, and the ways
elements refer to one another. The [language tour](tour.md) develops these ideas
through larger examples. The [specification](spec.md) is the normative reference.

## A complete document

```xdraw
diagram "Request flow" {
  subtitle "A browser, an API, and a data store"

  arrange grid { columns = 3; gap = 120 }

  browser: ellipse "Browser"
  api: rectangle "API" {
    body = "Validates the request"
    background = "#dbeafe"
  }
  store: rectangle "Orders"

  browser -> api "requests"
  api -> store "writes" { route = elbow }
}
```

The quoted string after `diagram` is the visible title. The body contains an
arrangement, three declarations, two connections, and properties that refine
their appearance or behaviour.

An XDraw file contains exactly one `diagram` or one hosted `scene` document.
This page concentrates on diagrams; [hosted scenes](tour.md#hosted-scenes) use
the same lexical rules with a small set of replacement and patch operations.

## Imports

Standard libraries add focused vocabularies. Imports appear before the diagram,
and imported constructors stay qualified by their alias.

```xdraw
use "xdraw/architecture" as arch

diagram "Context" {
  customer: arch.person "Customer"
  checkout: arch.system "Checkout"
  customer -> checkout "places an order"
}
```

Here `arch` is a local alias and `arch.person` is a constructor from the
architecture library. Imports do not place anything in the drawing by
themselves.

## Declarations and blocks

A declaration gives an element a stable ID and chooses a constructor:

```text
checkout: rectangle "Checkout" {
  body = "Validates the basket"
}
```

The parts are:

- `checkout` — the source ID used by references and connectors;
- `rectangle` — the constructor;
- `"Checkout"` — a constructor argument, here the visible title; and
- `{ ... }` — an optional block of properties or child statements.

Constructors decide which arguments, properties, and children are valid. A
`frame`, for example, may own declarations and an arrangement. A `rectangle`
accepts visual and content properties but cannot own arbitrary children.
Unknown or misplaced content is an error.

Containers create nested scopes:

```xdraw
diagram "A small system" {
  platform: frame "Platform" {
    arrange row { gap = 80 }
    api: rectangle "API"
    store: rectangle "Orders"
    api -> store "writes"
  }

  client: ellipse "Client"
  client -> platform.api "calls"
}
```

Inside the frame, `api` is enough. Outside it, the same element is addressed as
`platform.api`.

## Properties

A property assigns a value with `=`:

```text
body = "Validates the basket"
size = (220, 120)
stroke-width = 2
locked = true
route = curved
```

The constructor manifest defines each property's value kind. `size` expects a
point, `locked` a Boolean, and `route` one of a fixed set of identifiers.
Properties are checked in context rather than treated as an open-ended map.

Newlines and semicolons are both optional separators. These blocks mean the
same thing:

```text
{ size = (220, 120); opacity = 80 }

{
  size = (220, 120)
  opacity = 80
}
```

## Values and expressions

Common value forms are:

| Kind | Example |
|---|---|
| Number | `24`, `-3.5` |
| Boolean | `true`, `false` |
| String | `"Checkout"`, `"First\nSecond"` |
| Raw string | `"""\frac{a}{b}"""` |
| Identifier | `elbow`, `dashed`, `info` |
| Point | `(120, 80)` |
| Point list | `((20, 0), (20, 90))` |
| Interval membership | `x in [-pi, pi]` |
| Expression | `card.east + (40, 0)` |

Quoted strings recognize `\n`, `\t`, `\"`, and `\\`. Triple-quoted strings
are literal and are used where escapes would alter the content, such as TeX or
source code.

Expressions support `+`, `-`, `*`, `/`, and `^`; the constants `pi`, `tau`, and
`e`; and a bounded set of mathematical and geometry functions. They contain no
assignment or control flow. A binding names a reusable value:

```text
let margin = 32
let note_position = card.north-east + (margin, -margin)
note: text "Review" { at = note_position }
```

Bindings resolve by dependency, so their source order does not matter. Cycles
and names that no stage of compilation can supply are errors.

## References and measured geometry

Placed elements expose points that can be used in expressions:

```text
card.center
card.north
card.north-east
card.east
card.south-east
card.south
card.south-west
card.west
card.north-west
```

Their scalar measurements live under `bounds`, for example
`card.bounds.width`, `card.bounds.right`, and `card.bounds.bottom`. Use
`x(card.center)` or `y(card.center)` to project a point to one coordinate.

This allows placement to express a relationship instead of guessed canvas
coordinates:

```xdraw
diagram "Relative placement" {
  source: rectangle "Source" { size = (160, 90) }
  target: rectangle "Target" {
    at = source.north-east + (32, 0)
    size = (160, 90)
  }
}
```

Plots and freehand strokes are paths. `start(path)`, `end(path)`, and
`midpoint(path)` return named points. `along(path, u)` reads a point at an
arc-length fraction from 0 to 1; `tangent(path, u)` returns its direction and
`length(path)` its visible length.

`attach` states which object moves and which geometry it follows:

```text
attach leaf.origin to along(stem, 0.5)
attach flower.center to end(stem)
```

The compiler reports cyclic or impossible relationships instead of choosing an
arbitrary placement.

## Connections

`->` creates a directed connection and `--` creates an undirected line:

```text
source -> target
source -> target "request"
request: source@east -> target@west "request" {
  route = elbow
  head = triangle
}
```

An optional connection ID comes first, followed by endpoints, an optional
label, and an optional property block. `@east` and `@west` select attachment
sides. This endpoint syntax is distinct from point expressions: `source@east`
is a connector endpoint, while `source.east` is a measured point.

Connections may form a chain, such as `a -> b -> c`. Every operator in one
chain must match.

## Layout and geometry

An arrangement owns the direct visual children of its scope:

```text
arrange layered { direction = right; gap = 100 }
arrange grid { columns = 3; spacing = airy }
arrange row { gap = 60 }
```

At diagram scope, use `compact`, `grid`, or `layered`. A `frame`, `section`,
`group`, or lane may arrange its children as a `row`, `column`, or `grid`.
Choose either a named `spacing` or a numeric `gap`.

Precision geometry runs after automatic layout and works on selections:

```text
align top (first, second)
distribute x (first, second, third)
match-size (first, second) width
offset (label, note) by (0, -24)
rotate (arrow) 15
snap (first, second) to 8
bring-to-front (note)
```

These are statements, not properties. They express a relation among existing
elements; the compiler rejects a relation it cannot satisfy.

## Templates and repetition

A template names a reusable local pattern. Parameters are positional, and each
instance receives its own qualified IDs.

```xdraw
diagram "Reusable cards" {
  card: template(name) {
    item: rectangle "${name}"
  }

  first: card("First")
  second: card("Second")

  arrange grid { columns = 2; gap = 60 }
}
```

The two rectangles are `first.item` and `second.item`. `$parameter` substitutes
a complete property value; `${parameter}` interpolates a parameter into a
string.

A declaration may also repeat directly:

```text
service: rectangle "${each}" {
  each = ("auth", "billing", "search")
}

tick: ellipse {
  count = 5
  at = (80 * tick.index, 200)
}
```

`each` gives instances stable item names such as `service.auth`. `count` names
them by zero-based position, such as `tick.0`. Within an instance, `index` and
`count` are available to expressions and interpolation.

## Identifiers

Identifiers begin with an ASCII letter or underscore. The remaining characters
may be ASCII letters, digits, underscores, hyphens, or dots. They are
case-sensitive.

```text
checkout
order-store
_annotation
platform.api
```

Dots also separate qualified IDs and library names. Keywords are contextual, so
they are reserved only where the grammar expects them.

## Comments, whitespace, and source text

`#` begins a comment and continues to the end of the line:

```text
# The public entry point.
api: rectangle "API" # Measured before layout.
```

Spaces, tabs, carriage returns, newlines, and semicolons are insignificant
between tokens. XDraw source is Unicode text; identifiers remain ASCII so names
and diagnostics stay predictable. Error locations use one-based line and column
numbers.

For constructor-specific properties and accepted values, use `xdraw list` or
the tables in the [specification](spec.md). For complete programs, continue with
the [language tour](tour.md) or browse the [`examples/`](../examples/) directory.
