# XDraw Language Reference

XDraw source uses UTF-8 text. Statements may be separated by newlines or
semicolons. A `#` starts a line comment. Identifiers must match
`[A-Za-z_][A-Za-z0-9_.-]*`. Quoted strings support `\n`, `\t`, `\"`, and
`\\`; triple-quoted strings preserve multiline text.

A file may contain an explicit `diagram` or an implicit list of statements:

```xdraw
diagram "Simple flow" {
  source: card "Source"
  target: card "Target"
  source -> target
}
```

## Nodes

Declare a node as `<id>: <kind> <title> [tone]`:

```xdraw
diagram "Node types" {
  task: card "Task"
  owner: person "Owner"
  service: system "Service"
  records: database "Records"
  choice: decision "Approved?"
  milestone: ellipse "Complete"
  join: junction ""
}
```

Kinds are `card`, `person`, `system`, `database`, `decision`, `ellipse`, and
`junction`. Tones are `neutral`, `info`, `success`, `warning`, `danger`, and
`accent`.

Cards may contain supporting text and alignment:

```xdraw
diagram "Card text" {
  status: card "Approved" success {
    body "The request can proceed."
    text-align center
    vertical-align middle
  }
}
```

`text-align` accepts `left`, `center`, or `right`. `vertical-align` accepts
`top`, `middle`, or `bottom`.

## Connections

Connect existing IDs with `->`. Ports are `north`, `east`, `south`, and
`west`:

```xdraw
diagram "Connections" {
  source: system "Source"
  transform: system "Transform"
  target: database "Target"
  source.east -> transform.west -> target.west "flows"
}
```

Connection attributes appear in brackets:

```xdraw
diagram "Connection options" {
  a: card "A"
  b: card "B"
  a -> b "request" [style=elbow, dashed, head=arrow, width=3]
}
```

Styles are `auto`, `straight`, `elbow`, `curved`, and `line`; `auto` is the
default. Arrowheads are `arrow`, `bar`, `dot`, `circle`, `circle_outline`,
`triangle`, `triangle_outline`,
`diamond`, `diamond_outline`, `crowfoot_one`, `crowfoot_many`, and
`crowfoot_one_or_many`. Use `head=none` for no arrowhead.

Use `via="x,y;x,y"` for explicit waypoints. `start-label` and `end-label` add
endpoint labels.

## Containers and Layout

`lane`, `group`, and `frame` contain statements. Frames become native
Excalidraw frames:

```xdraw
diagram "Delivery" {
  layout grid columns 2 spacing normal

  lane build "Build" {
    layout row spacing normal
    code: system "Code"
    test: system "Tests"
    code -> test
  }

  frame release "Release" [locked] {
    artifact: database "Artifact"
    deploy: system "Deploy"
    artifact -> deploy
  }
}
```

Document layouts are `compact`, `grid`, and `layered`. Container layouts are
`row` and `column`. Spacing presets are `tight`, `normal`, and `airy`. Use
`gap <number>` when a precise minimum gap is required.

## Decisions

A decision may declare labelled branches to existing nodes:

```xdraw
diagram "Approval" {
  review: decision "Approved?" {
    when "yes" -> publish
    when "no" -> revise
  }
  publish: card "Publish" success
  revise: card "Revise" warning
}
```

## Trees and Sequences

Trees use recursive branches and leaves:

```xdraw
diagram "Outcomes" {
  tree result "Result" {
    branch accepted "Accepted" {
      leaf publish "Publish"
    }
    branch rejected "Rejected" {
      leaf revise "Revise"
    }
  }
}
```

Sequences declare participants before messages:

```xdraw
diagram "Request sequence" {
  sequence {
    participant user "User"
    participant api "API"
    participant store "Database"
    user -> api "Submit"
    api -> store "Save"
    store -> api "Saved"
  }
}
```

## Notes and Callouts

Attach annotations to a node port or place them explicitly:

```xdraw
diagram "Annotations" {
  service: system "Service"
  note owner "Owned by the platform team" at service.right
  callout review "Review before release" at (700, 260) -> service.bottom
}
```

## Text

Standalone text can auto-size or wrap to a fixed width:

```xdraw
diagram "Text" {
  text caption "Short label" at (100, 200)
  text summary "A longer explanation that wraps." at (100, 260) width 240 align left font 18
}
```

## Styles

Define a theme or reusable named style, then apply it with `style=<name>`:

```xdraw
diagram "Styles" {
  theme { font-family normal }
  style focus {
    stroke "#059669"
    background "#ecfdf5"
    text "#065f46"
  }
  target: system "Verified target" [style=focus]
}
```

Supported properties are `stroke`, `background`, `text`, `text-color`,
`stroke-width`, `stroke-style`, `fill-style`, `roughness`, `opacity`,
`font-family`, `font-size`, `title-size`, `body-size`, `line-height`, `padding`,
`link`, `locked`, `auto-size`, and `wrap-width`. Local attributes override a
named style.

## Components and Imports

Components accept named parameters and receive isolated IDs at each use site:

```xdraw
diagram "Services" {
  component service(name) {
    api: system "{name} API"
    store: database "{name} data"
    api -> store
  }
  use service orders [name="Orders"]
  use service billing [name="Billing"]
}
```

Use `import "relative/file.xdraw"` to load definitions from another file.
Imports resolve relative to the declaring file and may not escape the input
root.

## Images

Declare a PNG, GIF, JPEG, or safe SVG asset, then place an image or icon:

```text
asset logo "assets/logo.svg"
image brand logo at (80, 80) size (240, 120) [fit=contain, alt="Product logo"]
icon mark logo at (340, 80) size (64, 64)
```

Asset paths resolve relative to the declaring file. `fit` accepts `contain`,
`cover`, or `fill`. Assets are embedded in the generated document.

## Precision Geometry

Use explicit geometry only where automatic layout is insufficient:

```xdraw
diagram "Pinned layout" {
  first: card "First" at (100, 80) size (240, 100)
  second: card "Second" at (460, 80) size (240, 100)
  first.east -> second.west
  align top (first, second)
  match-size (first, second) both
}
```

Alignment modes are `left`, `center-x`, `right`, `top`, `center-y`, and
`bottom`. Use `distribute x (...)` or `distribute y (...)` for even spacing.
Other operations are `offset (...) by (x, y)`, `rotate (...) <degrees>`, and
`snap (...) to <grid-size>`. `match-size` accepts `width`, `height`, or `both`.

## Hosted Scene Documents

A scene resource is
`<provider>::<workspace>::<collection>::<scene>`. Excalidraw+ uses the
provider `excalidraw`; `default` selects the workspace associated with the API
key. Collection and scene segments may be IDs or unambiguous names.

Replace a complete hosted scene:

```xdraw
scene excalidraw::default::architecture::system_overview {
  replace {
    diagram "System overview" {
      api: system "API"
      data: database "Data"
      api -> data
    }
  }
}
```

Patch known DSL IDs while preserving unrelated elements:

```xdraw
scene excalidraw::default::architecture::system_overview {
  patch {
    update api {
      tone warning
      title "API v2"
    }
    delete data
    add {
      note review "Requires review" at (80, 80)
    }
  }
}
```

Patch properties are `tone`, `title`, `stroke`, `background`, `text`,
`stroke-width`, `opacity`, `x`, `y`, `width`, `height`, and `angle`. Angles are
in degrees. `update` and `delete` fail when the target ID is absent or
ambiguous.

## Validation

```bash
xdraw check diagram.xdraw
xdraw build diagram.xdraw
```

Validation covers syntax, imports, assets, references, style compatibility,
layout, and generated geometry.
