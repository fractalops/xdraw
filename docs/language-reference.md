# XDraw Language Reference

An XDraw file contains optional standard-library imports followed by one
diagram. Newlines and semicolons separate statements. `#` starts a comment.

```xdraw
use "xdraw/cards" as cards

diagram "Simple flow" {
  source: cards.card "Source"
  target: cards.card "Target"
  source -> target
}
```

Identifiers start with a letter or underscore and may contain letters,
numbers, `_`, `-`, and `.`. Strings use double quotes. Triple-quoted strings
preserve multiline content.

## Declarations

Every addressable element uses this form:

```text
<id>: <constructor> [arguments] ["label"] [{ properties and children }]
```

The ID is stable in the generated scene. Constructors determine what is
drawn. A block configures the element and may contain nested elements.

```xdraw
diagram "Core shapes" {
  task: rectangle "Task"
  milestone: ellipse "Complete"
  choice: diamond "Approved?"
  boundary: frame "Boundary" { item: rectangle "Contained" }
  caption: text "Independent text" { at (80, 420) }
}
```

Core constructors are `rectangle`, `ellipse`, `diamond`, `frame`, `group`,
`freedraw`, `text`, `code`, `style`, `theme`, `asset`, `image`, and
`component`. A `group` is an invisible selection and layout boundary.

The built-in standard libraries add semantic shapes and specialized layouts.
The importable set is fixed:

- `xdraw/cards`: `card`
- `xdraw/architecture`: `person`, `system`, `external-system`, `container`,
  `component`, `database`, `queue`, `system-boundary`, `container-boundary`,
  `deployment-node`, `group`
- `xdraw/process`: `lane`
- `xdraw/containers`: `section`
- `xdraw/sequence`: `diagram`, `participant`
- `xdraw/annotations`: `note`, `callout`
- `xdraw/connectors`: `junction`
- `xdraw/assets`: `icon`
- `xdraw/palette`: `neutral`, `info`, `success`, `warning`, `danger`, `accent`

Imports require an alias and constructor names remain qualified. Local file
imports and user-defined constructor libraries are not supported.

Architecture constructors compile to grouped native Excalidraw elements. They
use a C4-inspired hierarchy: people interact with software systems; systems
contain runtime containers; and containers contain components. `database` and
`queue` are recognizable container variants. Typed boundaries create native
frames and make the scope explicit.

```xdraw
use "xdraw/architecture" as arch

diagram "Order platform" {
  platform: arch.system-boundary "Order platform" {
    arrange row { gap 100 }
    customer: arch.person "Customer" {
      description "Places and tracks orders"
    }
    api: arch.container "Order API" {
      description "Accepts and coordinates orders"
      technology "TypeScript"
    }
    orders: arch.database "Orders" {
      description "Stores order state"
      technology "PostgreSQL"
    }
    events: arch.queue "Order events" {
      description "Distributes order changes"
      technology "Kafka"
    }

    customer -> api "places order"
    api -> orders "stores order" { technology "SQL" }
    api -> events "publishes change" { technology "Kafka protocol" }
  }
}
```

Architecture cards show their explicit role, technology, and description.
`description` is the architectural spelling of normal card `body` content;
using both on one element is invalid. The compiler reports advisory warnings
when architecture elements omit responsibilities, containers or components
omit technology, or relationships omit intent. Relationships between
containers should also name their protocol or technology.

The architecture library supplies notation rather than a separate modelling
language. A context, container, component, or deployment diagram is expressed
by selecting the appropriate constructors and typed boundary. Automatic views
derived from a shared architecture model are not currently generated.

`subtitle` adds one line of supporting text below the diagram title:

```xdraw
diagram "Deployment" {
  subtitle "Services and their release path"
  api: rectangle "API"
}
```

## Properties

Properties live inside the declaration block:

```xdraw
use "xdraw/cards" as cards
use "xdraw/palette" as palette

diagram "Properties" {
  request: cards.card "Request" {
    body "Supporting detail"
    style palette.info
    at (80, 120)
    size (240, 120)
    align left
    vertical-align top
  }
}
```

Common content properties are `body` and its architecture-oriented alias
`description`. Architecture nodes and relationships may also use `technology`.
Common visual properties include `style`, `stroke`, `background`,
`text-color`, `stroke-width`, `roughness`, `fill-style`, `opacity`,
`font-family`, `font-size`, `title-size`, `body-size`, `line-height`, `wrap-width`,
`auto-size`, `locked`, and `link`. Properties are validated against the
element they configure.

Named styles and the optional document theme use the same property syntax:

```xdraw
diagram "Styled" {
  default: theme { font-family normal }
  focus: style { stroke "#059669"; background "#ecfdf5" }
  target: rectangle "Target" { style focus }
}
```

## Freehand Drawing

`freedraw` creates a native, editable Excalidraw freehand element. `at` places
the stroke and each point is relative to that origin.

```xdraw
diagram "Signature" {
  mark: freedraw {
    at (120, 100)
    points ((0, 20), (30, 0), (70, 45), (110, 10))
    stroke "#2563eb"
    stroke-width 6
  }
}
```

Without `pressures`, Excalidraw simulates pen pressure. To preserve measured
pressure, provide one value from `0` to `1` per point and disable simulation:

```xdraw
diagram "Measured stroke" {
  mark: freedraw {
    at (120, 100)
    points ((0, 20), (30, 0), (70, 45), (110, 10))
    pressures (0.2, 0.5, 0.9, 0.3)
    simulate-pressure false
  }
}
```

Freehand elements support `align`, `distribute`, `offset`, `rotate`, and
`snap`. They do not support `match-size` because resizing a stroke must also
transform its point geometry.

## Namespaces and Anchors

A block-bodied declaration creates a namespace. Local references work inside
the block; outside references use the qualified source ID.

```xdraw
diagram "Namespaces" {
  source: frame "Source" { api: rectangle "API" }
  target: frame "Target" { store: ellipse "Store" }
  source.api@right -> target.store@left "copies"
}
```

`.` separates namespace segments. `@` selects `top`, `right`, `bottom`,
`left`, or `center` without confusing an anchor with a child ID.

## Connections

`->` creates an arrow and `--` creates a line. A connection may have a stable
source ID, a label, and properties:

```xdraw
diagram "Connections" {
  source: rectangle "Source"
  target: rectangle "Target"
  request: source@right -> target@left "request" {
    route elbow
    stroke-style dashed
    head triangle
    start-label "caller"
    end-label "callee"
  }
}
```

Routes are `auto`, `straight`, `elbow`, and `curved`. `via ((x, y), (x, y))`
adds explicit waypoints. Arrowheads include `arrow`, `bar`, `dot`, `circle`,
`triangle`, `diamond`, their `_outline` variants, and the crow-foot variants.
Use `head none` for no arrowhead.

## Arrangement

An arrangement owns the direct visual children of its enclosing scope:

```xdraw
use "xdraw/containers" as containers

diagram "Delivery" {
  arrange grid { columns 2; gap 30 }
  build: containers.section "Build" {
    arrange row { gap 80 }
    code: rectangle "Code"
    test: rectangle "Tests"
    code -> test
  }
  release: frame "Release" {
    arrange column { gap 24 }
    approve: diamond "Approved?"
    deploy: rectangle "Deploy"
  }
}
```

Use `row` or `column` inside containers. Documents also support `compact`,
`grid`, and `layered`. Options include `gap`, `columns`, `width`, and spacing
presets `tight`, `normal`, and `airy`.

Tree arrangement derives a hierarchy from local arrows:

```xdraw
use "xdraw/cards" as cards
use "xdraw/containers" as containers

diagram "Outcomes" {
  outcomes: containers.section "Outcomes" {
    arrange tree { root result; direction right; level-gap 90; sibling-gap 28 }
    result: cards.card "Result"
    accepted: cards.card "Accepted"
    rejected: cards.card "Rejected"
    result -> accepted
    result -> rejected
  }
}
```

A tree rejects cycles, multiple parents, and nodes unreachable from its root.

Use `group` when elements should move and arrange together without a visible
container:

```xdraw
diagram "Grouped" {
  pair: group {
    arrange row { gap 40 }
    first: rectangle "First"
    second: rectangle "Second"
  }
}
```

## Sequences and Annotations

```xdraw
use "xdraw/annotations" as annotations
use "xdraw/sequence" as seq

diagram "Interaction" {
  interaction: seq.diagram {
    user: seq.participant "User"
    api: seq.participant "API"
    user -> api "Submit"
    api -> user "Accepted"
  }
  note: annotations.note "Review the response" { attach interaction.api@bottom }
}
```

Notes attach with `attach <id>@<anchor>`. A callout is a warning-styled card
that can be connected with the normal arrow syntax.

## Components

Components are document-scoped templates. `$name` supplies a parameter to a
property and `${name}` interpolates it into a string.

```xdraw
use "xdraw/architecture" as arch
use "xdraw/palette" as palette

diagram "Services" {
  service: component(name, visual_style) {
    api: arch.system "${name} API" { style $visual_style }
    store: arch.database "${name} data"
    api -> store
  }
  orders: service("Orders", palette.info)
  billing: service("Billing", palette.warning)
}
```

Component instances receive isolated qualified IDs such as `orders.api`.

## Text and Images

Free text may auto-size or wrap:

```xdraw
diagram "Text" {
  short: text "Short label" { at (100, 200) }
  summary: text "A longer explanation that wraps." {
    at (100, 260); wrap-width 240; align left; font-size 18
  }
}
```

Code blocks preserve relative indentation, use a monospace font, and never
wrap their source text. Use `title` for a human-facing heading and `language`
for the source-language label. Line numbers are shown by default. Set
`highlight true` for SQL, TypeScript, or XDraw highlighting.
Large blocks fall back to plain monospace text to keep the scene responsive.
The CLI prepares highlighting automatically. Programmatic callers use
`compileAsync()` for highlighted output; synchronous `compile()` preserves the
code as plain editable text.

```xdraw
diagram "Example" {
  sample: code """
    function greet(name: string) {
      return `Hello, ${name}`
    }
  """ {
    title "Greeting function"
    language typescript
    line-numbers false
    highlight true
  }
}
```

Assets are safe PNG, GIF, JPEG, or SVG files. Paths resolve relative to the
source file and are embedded in the output.

```text
use "xdraw/assets" as assets

diagram "Assets" {
  logo: asset "assets/logo.svg"
  hero: image(logo) { at (80, 80); size (240, 120); fit contain; alt "Logo" }
  mark: assets.icon(logo) { at (340, 80); size (64, 64) }
}
```

## Precision Geometry

Use explicit geometry when automatic arrangement is insufficient:

```xdraw
diagram "Pinned layout" {
  first: rectangle "First" { at (100, 80); size (240, 100) }
  second: rectangle "Second" { at (460, 120); size (240, 100) }
  third: rectangle "Third" { at (820, 160); size (240, 100) }
  align top (first, second, third)
  distribute x (first, second, third)
  match-size (first, second) both
  offset (third) by (0, 20)
  rotate (third) 5
  snap (first, second) to 10
}
```

Alignment modes are `left`, `center-x`, `right`, `top`, `center-y`, and
`bottom`. Distribution axes are `x` and `y`. `match-size` accepts `width`,
`height`, or `both`.

## Hosted Scene Documents

A scene resource is `<provider>::<workspace>::<collection>::<scene>`.
Excalidraw+ uses the provider `excalidraw`; `default` selects the workspace
associated with the API key.

```xdraw
scene excalidraw::default::architecture::system_overview {
  replace {
    use "xdraw/architecture" as arch
    diagram "System overview" {
      api: arch.system "API"
      data: arch.database "Data"
      api -> data
    }
  }
}
```

Patch known source IDs while preserving unrelated elements:

```xdraw
scene excalidraw::default::architecture::system_overview {
  patch {
    update api { tone warning; title "API v2" }
    delete data
    add { review: rectangle "Requires review" { at (80, 80) } }
  }
}
```

Patch properties are `tone`, `title`, `stroke`, `background`, `text`,
`stroke-width`, `opacity`, `x`, `y`, `width`, `height`, and `angle`.

## Validation

```bash
xdraw check diagram.xdraw
xdraw build diagram.xdraw
```

Validation covers syntax, assets, references, styles, layout, and generated
geometry.
