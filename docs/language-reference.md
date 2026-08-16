# XDraw Language Guide

XDraw turns concise source into editable Excalidraw scenes. This guide covers
the common authoring workflow. The [language specification](spec.md) defines
the complete syntax and validation rules.

## Start a Diagram

Every local document contains one named diagram:

```xdraw
diagram "Release flow" {
  plan: rectangle "Plan"
  ship: ellipse "Released"
  plan -> ship "approve"
}
```

Each declaration has a stable ID, a constructor, and usually a visible title:

```text
id: constructor "Title" { properties and children }
```

Core drawing constructors are `rectangle`, `ellipse`, `diamond`, `frame`,
`section`, `group`, `text`, `code`, `freedraw`, `asset`, and `image`.
Definitions used for reuse are `template`, `style`, and `theme`.

Comments begin with `#`. Newlines and semicolons are optional separators, so
use whichever makes the source easiest to read.

## Add Content and Style

Properties live inside an element block:

```xdraw
use "xdraw/palette" as palette

diagram "Styled cards" {
  default: theme { font-family normal }
  emphasis: style {
    stroke "#0f766e"
    background "#ccfbf1"
  }

  request: rectangle "Request" {
    body "Ready for review"
    style emphasis
    size (260, 120)
    align left
    vertical-align top
  }
  approved: rectangle "Approved" { style palette.success }
  request -> approved
}
```

A theme supplies document defaults. A named style overrides the theme, and
properties on an element override both. Palette tones are `neutral`, `info`,
`success`, `warning`, `danger`, and `accent`.

Use `at (x, y)` for explicit placement and `size (width, height)` for explicit
dimensions. Most diagrams need neither because XDraw measures and arranges
their content.

## Arrange Elements

At diagram scope, use `compact`, `grid`, or `layered`:

```xdraw
diagram "Service flow" {
  arrange layered { spacing airy }
  client: rectangle "Client"
  api: rectangle "API"
  store: ellipse "Store"
  client -> api
  api -> store
}
```

Inside a frame, group, section, or lane, use `row` or `column`:

```xdraw
diagram "Grouped work" {
  delivery: frame "Delivery" {
    arrange row { gap 56 }
    build: rectangle "Build"
    verify: rectangle "Verify"
    build -> verify
  }
}
```

`group` is an invisible layout and selection boundary. `section` is a visible
layout panel. `frame` is a native Excalidraw frame whose children move with it.

For a strict hierarchy, derive a tree from local arrows:

```xdraw
diagram "Outcomes" {
  outcomes: frame "Outcomes" {
    arrange tree { root result; direction right }
    result: rectangle "Result"
    accepted: rectangle "Accepted"
    rejected: rectangle "Rejected"
    result -> accepted
    result -> rejected
  }
}
```

Tree nodes must be direct children, reachable from the root, acyclic, and
limited to one parent each.

## Connect and Address Elements

Use `->` for an arrow and `--` for a line. Add anchors when the attachment side
matters:

```xdraw
diagram "Request path" {
  source: frame "Source" { api: rectangle "API" }
  target: frame "Target" { worker: rectangle "Worker" }

  request: source.api@right -> target.worker@left "submit" {
    route elbow
    stroke-style dashed
    head triangle
  }
}
```

Nested declarations create qualified IDs such as `source.api`. Inside a
container, local names resolve before outer names. Anchors are `top`, `right`,
`bottom`, `left`, and `center`.

Connections can use `auto`, `straight`, `elbow`, or `curved` routes. Use
`via ((x, y), (x, y))` when a connector needs explicit waypoints.

## Use Semantic Libraries

Standard-library constructors make intent visible while still producing
ordinary editable Excalidraw elements:

```xdraw
use "xdraw/architecture" as arch

diagram "Order context" {
  customer: arch.person "Customer" {
    description "Places and tracks orders"
  }
  platform: arch.system "Order platform" {
    description "Coordinates order processing"
  }
  customer -> platform "places order" { technology "HTTPS" }
}
```

Available libraries are:

| Import | Exports |
|---|---|
| `xdraw/architecture` | `person`, `system`, `external-system`, `container`, `component`, `database`, `queue`, `system-boundary`, `container-boundary`, `deployment-node`, `group` |
| `xdraw/process` | `lane` |
| `xdraw/sequence` | `sequence`, `participant` |
| `xdraw/table` | `table`, `header`, `row` |
| `xdraw/math` | `formula`, `plot` |
| `xdraw/annotations` | `note`, `callout` |
| `xdraw/connectors` | `junction` |
| `xdraw/assets` | `icon` |
| `xdraw/palette` | `neutral`, `info`, `success`, `warning`, `danger`, `accent` |

Imports require an alias. Use qualified names such as `arch.system`; imports
do not add unqualified constructors.

The compiler validates every document against these library manifests, and
reports the offending constructor or property with its source location when a
document does not match. Tools that need the manifests programmatically can
import `listLibraryManifests` and `getLibraryManifest` from the package.

Tables calculate column widths from their content and wrap cells when space
is constrained. The generated cells remain editable Excalidraw rectangles and
text:

```xdraw
use "xdraw/table" as table

diagram "Orders" {
  orders: table.table "Orders" {
    table.header "Order" "Customer" "Total"
    table.row "1001" "A. Ndlovu" "R450"
    table.row "1002" "K. Singh" "R980"
  }
}
```

`table.header` and `table.row` are anonymous child constructors, so they do
not need an `id:` prefix. A table requires exactly one header and at least one
row. Every row must have the same number of cells as the header.

Formulas accept raw triple-quoted TeX and compile to deterministic embedded
SVG. The result is a movable and resizable image; its authored TeX and renderer
version remain attached for inspection:

```xdraw
use "xdraw/math" as math

diagram "Formula" {
  gaussian: math.formula """
    \int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
  """
}
```

Use triple quotes for every formula so backslashes remain literal. Common
indentation is ignored during rendering. The supported TeX packages are `base`
and `ams`; commands that would load remote or executable content are rejected.
Formula count, source length, output size, and image dimensions are bounded.
Programmatic consumers must use `compileAsync()` for a document containing
`math.formula`; the CLI selects it automatically.

`math.plot` draws a parametric curve from a pair of expressions in `t`. It
compiles to an ordinary freehand stroke, so the result is editable like any
other:

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

Expressions use a closed vocabulary: the operators `+ - * / ^`, the constants
`pi`, `tau`, and `e`, eighteen functions (`sin`, `cos`, `tan`, `asin`, `acos`,
`atan`, `atan2`, `sqrt`, `abs`, `sign`, `floor`, `ceil`, `round`, `min`, `max`,
`exp`, `log`, `hypot`), and the single variable `t`. There is no assignment, no
control flow, and no property access. An unknown name or the wrong number of
arguments is reported when the document is read.

`tolerance` sets the greatest distance the drawn line may fall from the true
curve, in pixels, and defaults to `0.5`. It is a guarantee rather than a
target: the compiler bounds each span of the curve rather than sampling it, so
a curve it cannot draw within the tolerance — one with a pole, or one that
leaves the usable coordinate range — is refused with a diagnostic instead of
being approximated.

A sequence uses `seq.sequence` as its container and needs at least two
participants:

```xdraw
use "xdraw/sequence" as seq

diagram "Request" {
  interaction: seq.sequence {
    client: seq.participant "Client"
    server: seq.participant "Server"
    client -> server "request"
    server -> client "response"
  }
}
```

## Reuse a Pattern

Document-scoped templates expand into isolated, addressable elements:

```xdraw
use "xdraw/architecture" as arch
use "xdraw/palette" as palette

diagram "Services" {
  service: template(name, visual_style) {
    api: arch.container "${name} API" { style $visual_style }
    data: arch.database "${name} data"
    api -> data
  }

  orders: service("Orders", palette.info)
  billing: service("Billing", palette.warning)
}
```

Arguments bind by position. `$name` supplies a complete property value and
`${name}` interpolates into a string. Instance IDs are qualified, for example
`orders.api` and `billing.api`.

## Add Text, Code, and Images

Triple-quoted strings are useful for multiline code:

```xdraw
diagram "Example source" {
  heading: text "Validation" { font-size 24 }
  sample: code """
    diagram "Hello" {
      message: rectangle "Hello, Excalidraw"
    }
  """ {
    title "XDraw"
    language xdraw
    highlight true
  }
}
```

Code highlighting supports `xdraw`, `typescript`, and `sql`. Line numbers are
on by default.

Images are embedded into the output scene. Paths are relative to the source
file:

```xdraw
diagram "Assets" {
  logo: asset "corpus/assets/xdraw-mark.svg"
  preview: image(logo) {
    at (80, 80)
    size (320, 160)
    fit contain
    alt "Project logo"
  }
}
```

PNG, GIF, JPEG, and safe SVG files are supported.

## Refine Geometry

Automatic layout can be followed by explicit geometry operations:

```xdraw
diagram "Aligned" {
  first: rectangle "First"
  second: rectangle "Second"
  third: rectangle "Third"

  align top (first, second, third)
  distribute x (first, second, third)
  match-size (first, second, third) both
  offset (third) by (0, 24)
  snap (first, second, third) to 8
}
```

Alignment modes are `left`, `center-x`, `right`, `top`, `center-y`, and
`bottom`. `match-size` accepts `width`, `height`, or `both`.

## Edit a Hosted Scene

A scene document addresses one Excalidraw+ scene and either replaces or
patches it:

```xdraw
scene excalidraw::default::architecture::overview {
  patch {
    update api { tone warning; title "API v2" }
    delete legacy
    add {
      review: rectangle "Review" { at (80, 80) }
    }
  }
}
```

Use `xdraw list` to discover scene addresses. `replace` contains one complete
diagram; `patch` can `update`, `delete`, and `add` while preserving unrelated
elements. See the [Excalidraw+ guide](excalidraw-plus-integration.md).

## Check and Build

```bash
xdraw check diagram.xdraw
xdraw build diagram.xdraw
xdraw build diagram.xdraw -o diagram.png
cat diagram.xdraw | xdraw build -o diagram.excalidraw
```

Use the [language specification](spec.md) for the complete grammar, property
types, semantic constraints, processing model, and implementation limits.
