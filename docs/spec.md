# XDraw Language Specification

This document defines the XDraw 0.1 source language. It is the normative
reference for parsers, compilers, tooling, and authored XDraw documents.

The examples are illustrative. When an example conflicts with the prose or
grammar, the prose and grammar take precedence.

## 1. Scope

XDraw is a declarative language for producing editable Excalidraw scenes. It
defines:

- diagram documents for local compilation;
- scene documents for replacing or patching hosted scenes;
- stable source identities and scoped references;
- constructors, properties, connections, and layout constraints;
- reusable templates, styles, themes, and standard libraries; and
- deterministic validation and lowering into native Excalidraw elements.

This specification does not define the Excalidraw JSON format, preview
rendering, command-line flags, or the Excalidraw+ HTTP protocol.

## 2. Conformance

The key words **must**, **must not**, **required**, **should**, **should not**,
and **may** are to be interpreted as normative requirements.

A conforming document must satisfy lexical, syntactic, name-resolution, and
semantic validation. A conforming compiler must reject an invalid document
before publishing or writing a completed scene. It may emit advisory warnings
for valid but underspecified content.

Unknown constructors, properties, references, styles, libraries, and patch
targets must not be silently reinterpreted.

## 3. Syntax Notation

The grammar uses these conventions:

```text
rule       = required sequence
[ rule ]   = optional sequence
{ rule }   = zero or more repetitions
rule | alt = alternatives
"text"     = literal source text
```

Grammar productions describe token order. Whitespace, comments, and optional
semicolons may occur between tokens unless a production says otherwise.

## 4. Source Text

### 4.1 Characters and positions

Source is Unicode text. Identifiers are intentionally limited to ASCII. Error
locations use one-based line and column numbers.

### 4.2 Whitespace and semicolons

Spaces, tabs, carriage returns, and newlines are insignificant between tokens.
A semicolon is treated as whitespace. Statements therefore do not require a
newline or semicolon terminator; their grammar determines their boundary.

### 4.3 Comments

`#` begins a comment that continues to the end of the line. Comments do not
affect compilation.

```xdraw
# A comment before the document.
diagram "Commented" {
  source: rectangle "Source" # A trailing comment.
}
```

### 4.4 Identifiers

```text
identifier = (letter | "_"), { letter | digit | "_" | "-" | "." }
letter     = "A" ... "Z" | "a" ... "z"
digit      = "0" ... "9"
```

Identifiers are case-sensitive. Reserved words are contextual: for example,
`diagram` is special where a document declaration is expected but may appear
inside a longer identifier.

### 4.5 Numbers

```text
number = [ "-" ], digit, { digit }, [ ".", digit, { digit } ]
```

Numbers are finite decimal values. Exponential notation is not supported.

### 4.6 Strings

A quoted string begins and ends with `"`. It supports `\n`, `\t`, `\"`, and
`\\`. Any other escape is invalid.

A triple-quoted string begins and ends with `"""`. Its content is literal. If
the first or last content character is a newline, that one newline is removed.
Triple-quoted strings do not process escapes.

Constructor manifests may require a raw string. A raw-string argument accepts
only the triple-quoted form; this prevents content such as TeX commands from
being changed by quoted-string escape processing.

```xdraw
diagram "Strings" {
  label: text "First\nSecond"
  source: code """
    SELECT id
    FROM orders
  """ { language sql }
}
```

### 4.7 Punctuation

The language uses `{ } ( ) : , ; @ $ =`, the connection operators `->` and
`--`, and the scene namespace separator `::`.

## 5. Document Forms

An XDraw source file contains exactly one diagram document or one scene
document.

### 5.1 Diagram document

```text
diagram-document = { import }, diagram
import           = "use", string, "as", identifier
diagram          = "diagram", string, block
block            = "{", { statement }, "}"
statement        = subtitle-statement | declaration | anonymous-invocation | connection
                 | arrangement | geometry-operation | property
property-block   = "{", { property }, "}"
```

Imports must precede the diagram. Content after the diagram is invalid.

```xdraw
diagram "Simple flow" {
  source: rectangle "Source"
  target: rectangle "Target"
  source -> target
}
```

The diagram string is its visible title. A diagram may contain a `subtitle`
statement. Authors should declare at most one; the first subtitle is rendered:

```text
subtitle-statement = "subtitle", string
```

### 5.2 Scene document

```text
scene-document = "scene", scene-resource, "{", scene-operation, "}"
scene-resource = identifier, "::", identifier, "::", identifier, "::", identifier
scene-operation = replace-operation | patch-operation
```

The four resource segments are provider, workspace, collection, and scene. The
only supported provider is `excalidraw`.

Scene operations are specified in section 17.

## 6. Values

```text
value       = string | number | identifier | pair | interval | expression
pair        = "(", number, ",", number, ")"
interval    = "(", interval-end, ",", interval-end, ")"
interval-end = number | "pi" | "tau" | "e"
point-list  = "(", pair, { ",", pair }, ")"
number-list = "(", number, { ",", number }, ")"
selection   = "(", identifier, { ",", identifier }, ")"
```

The identifiers `true` and `false` become Boolean values where a property
accepts a Boolean.

## 7. Declarations and Constructors

```text
declaration          = identifier, ":", constructor, [ arguments ], [ block ]
anonymous-invocation = constructor, arguments, [ block ]
constructor          = identifier
arguments            = string, { string }
                     | "(", [ value, { ",", value } ], ")"
```

The declaration identifier is the element's source identity. Constructors
determine the meaning of arguments, allowed children, and applicable
properties.

For title-bearing constructors, the first argument is the visible title. When
it is omitted, the declaration identifier is used. Additional arguments have
meaning only when the constructor defines them.

A library manifest may mark a constructor as anonymous. Anonymous
constructors omit the declaration ID and are valid only inside a declaration
whose child policy accepts them. Their constructor name must remain qualified,
and they do not create addressable scene objects. Named constructors must use
the regular `id: constructor` form.

### 7.1 Core constructors

| Constructor | Meaning | Required form |
|---|---|---|
| `rectangle` | Rectangular node | Optional title |
| `ellipse` | Elliptical node | Optional title |
| `diamond` | Decision node | Optional title |
| `frame` | Visible native frame | Optional title and child block |
| `section` | Visible semantic container | Optional title and child block |
| `group` | Invisible selection and layout boundary | Optional title and child block |
| `text` | Free or layout-owned text | Exactly one string argument |
| `code` | Editable code block | Exactly one string argument |
| `freedraw` | Native freehand stroke | No arguments; `at` and `points` required |
| `style` | Named style | Property block; document scope only |
| `theme` | Document defaults | Property block; at most one per document |
| `asset` | Embedded asset declaration | Exactly one source string |
| `image` | Asset instance | Asset reference; `at` and `size` required |
| `template` | Reusable definition | Parameter identifiers; document scope only |

`style`, `theme`, `asset`, and `template` declarations do not directly draw a
visible element.

### 7.2 Property statements

Within a declaration or property block, a property is written as its name
followed by the value required by that property:

```text
property = identifier, property-value
         | identifier, "=", expression
```

The second form introduces an expression, and is required wherever a property
declares the expression value kind. An expression is not delimited: it ends
where the grammar ends it, because after a complete term only an operator can
continue one, so the next property name or closing brace terminates it. Line
breaks remain insignificant. Section 15.5 defines the expression grammar.

Unknown properties are invalid. A property is also invalid when it does not
apply to its enclosing constructor.

| Value shape | Properties |
|---|---|
| Coordinate pair | `at`, `size` |
| String | `body`, `description`, `technology`, `stroke`, `background`, `text-color`, `start-label`, `end-label`, `alt`, `link`, `title` |
| Number | `gap`, `columns`, `width`, `stroke-width`, `roughness`, `opacity`, `padding`, `font-size`, `line-height`, `title-size`, `body-size`, `wrap-width`, `level-gap`, `sibling-gap` |
| Identifier | `style`, `spacing`, `direction`, `root`, `route`, `stroke-style`, `fill-style`, `font-family`, `align`, `vertical-align`, `fit`, `head`, `language` |
| Boolean | `auto-size`, `locked`, `simulate-pressure`, `line-numbers`, `highlight` |
| Point list | `via`, `points` |
| Number list | `pressures` |
| Element endpoint | `attach` |

Node content may use `body` or `description`, but not both. `description` is
the architecture-oriented spelling of the same content role. Architecture
elements and relationships may also declare `technology`.

### 7.3 Named values

A `let` statement binds a name to a number for the document:

```text
binding = "let", identifier, "=", expression
```

Bindings resolve by dependency rather than by source order, so a name may be
used before it is bound. A binding whose expression depends on itself, directly
or through others, is invalid, as is a name used but never bound, a name bound
more than once, a name that a constant or function of the expression
sublanguage already defines, and a binding that does not evaluate to a finite
number.

A bound name may appear in any expression. Where every free name of an
expression is bound, the expression becomes its value; where a name remains that
another binder supplies, `t` in a plotted curve, the bound parts are
substituted and the expression is preserved.

Within an expression, a name is a number that some part of compilation supplies
later: a `let` binding, a repeat's `index` or `count`, a template parameter, or
a placed element's geometry. A name no stage supplies is invalid, and is
reported against the property that used it. A document cannot observe whether a
value has been supplied yet.

String interpolation is a separate mechanism: `${name}` in a string is text
somebody supplies, not arithmetic, and the two do not mix.

### 7.4 Repetition

A declaration may carry `each` or `count`, but not both, and produces one
element per instance:

```text
repetition = "each", "(", string, { ",", string }, ")"
           | "count", number
```

`each` identifies each instance by its item, appended to the declaration's own
id; `count` identifies by position from zero. An item must be usable as an
identifier and must not repeat, since two instances cannot share a name. A count
must be a whole number of at least one. A declaration may produce at most 512
instances.

Within an instance, `${each}` is the item, and `<id>.index` and `<id>.count` are
the instance's position and the total. Every name an instance supplies is
available in two forms: bare inside an expression, and wrapped in `${...}`
inside a string. A `${...}` name the repeat does not supply is left untouched,
because template expansion uses the same marker and runs afterwards. A repeated
declaration inside a container expands before its container does.

## 8. Imports and Standard Libraries

Imports bind a library to an alias. Aliases must be unique. Imported
constructors remain qualified:

```xdraw
use "xdraw/architecture" as arch

diagram "Context" {
  user: arch.person "User"
  product: arch.system "Product"
  user -> product "uses"
}
```

The core vocabulary and every standard library are described by library
manifests. A manifest defines exported constructors and values, constructor
arguments, allowed properties, child roles, defaults, and semantic lowering. A
constructor's lowering names the semantic kind it produces, the element kind it
draws as, its tone, and the border a connector meets it on. A
conforming compiler must apply the core manifest, an imported library manifest,
or a document-scoped template before semantic lowering. It must reject:

- an unknown library, alias, or constructor;
- an unknown qualified library value;
- missing, extra, or incorrectly typed constructor arguments;
- unknown, misplaced, or incorrectly typed properties; and
- children that violate the constructor's declared roles or cardinality.

Core constructors belong to `xdraw/core` and are available without an import.
Standard-library constructors require a qualified imported alias.

The standard libraries are:

| Library | Exports |
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

Local library imports and user-defined constructor libraries are not part of
XDraw 0.1.

Architecture constructors express a C4-inspired vocabulary. They emit
ordinary editable elements and do not form a separate sublanguage. A compiler
may warn when architecture elements omit a description, runtime elements omit
technology, or relationships omit intent.

The table library emits grouped native rectangles and text. A table requires
one header followed by one or more rows, and every row must contain the same
number of cells:

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

The math library exposes the named `formula` constructor. It accepts exactly
one raw triple-quoted TeX string and emits a grouped image backed by
deterministic embedded SVG. Common indentation and line endings are normalized
for rendering; the authored source remains in the image metadata together with
the renderer identity, renderer version, display mode, and content digest.

Formulas use display mode and the MathJax `base` and `ams` packages. They may
not reference remote or executable content. A document may contain at most 100
formulas. Each formula is limited to 2,048 source characters and the document
to 32,768 formula-source characters. Each generated SVG is limited to 256 KiB
and 8,192 pixels per dimension; all generated formula SVGs are limited to 5 MiB
per document. Empty input, unsupported commands, unsafe SVG, and exceeded
limits are errors.

```xdraw
use "xdraw/math" as math

diagram "Formula" {
  result: math.formula """
    \sum_{k=1}^{n} k = \frac{n(n+1)}{2}
  """
}
```

## 9. Identity, Scope, and References

Every addressable declaration has a stable source ID. A declaration containing
children creates a scope. A child's qualified ID is its ancestors' IDs joined
with `.`.

References are resolved from the nearest scope outward. A qualified reference
may address a nested element directly.

```xdraw
diagram "Scopes" {
  client: frame "Client" { api: rectangle "Client API" }
  server: frame "Server" { api: rectangle "Server API" }
  client.api -> server.api
}
```

Duplicate semantic IDs are invalid. References to unknown elements are
invalid.

### 9.1 Anchors

```text
endpoint = identifier, [ "@", anchor ]
anchor   = "top" | "right" | "bottom" | "left" | "center"
```

The synonyms `north`, `east`, `south`, and `west` are accepted by the semantic
model. Authors should prefer the five canonical spellings above.

An anchor selects the attachment side and is not part of the referenced
element's source ID. A written anchor attaches at that side's midpoint. When
both endpoints of a `straight` or `line` connection omit their anchor, each end
attaches where the segment between the two centres crosses the border, so
several connectors leaving one element in different directions do not share a
point. Routed styles always attach at the midpoint, because their first segment
leaves perpendicular to the side.

Which border that is depends on the element. A drawn stroke is met where the ray
last crosses the line it draws, so a plotted shape is met on its own outline; the
furthest crossing is used, because a curve that folds back over itself should be
met at its outer boundary. Every other element is met on the border its kind
declares in its library manifest, which is one of `box`, `ellipse`, or `diamond`.
A kind that declares none is a box.

## 10. Connections

```text
connection = [ identifier, ":" ], endpoint, operator, endpoint,
             { operator, endpoint }, [ string ], [ property-block ]
operator   = "->" | "--"
```

A chain must use one operator. `->` creates directed relationships; `--`
creates an undirected line. A leading identifier gives the connection a stable
source ID.

```xdraw
diagram "Connections" {
  source: rectangle "Source"
  target: rectangle "Target"
  request: source@right -> target@left "request" {
    route elbow
    head triangle
    start-label "caller"
    end-label "callee"
  }
}
```

Connection routes are `auto`, `straight`, `elbow`, `curved`, and `line`.
Authors should use `--` instead of spelling `route line`. `via` supplies
explicit waypoints.

Arrowheads are `none`, `arrow`, `bar`, `dot`, `circle`, `circle_outline`,
`triangle`, `triangle_outline`, `diamond`, `diamond_outline`, `crowfoot_one`,
`crowfoot_many`, and `crowfoot_one_or_many`.

Connection width must be positive. Connections support `solid` and `dashed`
stroke styles. Other drawable elements may also use `dotted`.

## 11. Layout

```text
arrangement = "arrange", identifier, property-block
```

An arrangement owns the direct visual children of its enclosing scope.

At diagram scope, supported arrangements are `compact`, `grid`, and `layered`.
Within a lane, group, frame, or section, supported arrangements are `row` and
`column`.
`columns` applies only to document-level `grid`.

Layout may use one of:

- `spacing tight`, `spacing normal`, or `spacing airy`; or
- a non-negative numeric `gap`.

`spacing` and `gap` must not appear together. `width` must be positive and
`columns` must be a positive integer.

A `row` distributes the space left over after its children and gaps are placed,
growing every child by the same amount. A declared `size` width is therefore a
starting width inside a row: it determines how many children fit on one line,
and differences between sibling widths are preserved, but the widths themselves
are not. A `column`, and a scope with no arrangement, use a declared `size`
width exactly, even where that overflows the enclosing scope.

### 11.1 Tree arrangement

`arrange tree` is valid inside a declaration and derives a hierarchy from the
arrows among that declaration's direct node children.

```xdraw
diagram "Tree" {
  hierarchy: frame "Hierarchy" {
    arrange tree {
      root parent
      direction down
      level-gap 72
      sibling-gap 28
    }
    parent: rectangle "Parent"
    first: rectangle "First"
    second: rectangle "Second"
    parent -> first
    parent -> second
  }
}
```

`root` is required. `direction` is `down` or `right`. Every node must be
reachable from the root, may have at most one parent, and must participate in
an acyclic graph. Tree connections may reference only direct child nodes.

## 12. Precision Geometry

```text
geometry-operation = alignment | distribution | offset | match-size
                   | rotation | snap | layer
alignment    = "align", alignment-mode, selection
distribution = "distribute", ( "x" | "y" ), selection
offset       = "offset", selection, "by", pair
match-size   = "match-size", selection, [ "width" | "height" | "both" ]
rotation     = "rotate", selection, number
snap         = "snap", selection, "to", number
layer        = ( "bring-to-front" | "send-to-back" ), selection
```

Alignment modes are `left`, `center-x`, `right`, `top`, `center-y`, and
`bottom`. Alignment requires at least two targets. Distribution requires at
least three targets. `match-size` requires at least two targets and defaults
to `both`. Snap grid size must be positive. Target selections must not contain
duplicates.

Geometry operations apply after automatic layout. Nodes and sequence
participants support all operations. Code supports `align`, `distribute`,
`offset`, and `snap`. Freehand supports `align`, `distribute`, `offset`,
`rotate`, and `snap`. Neither supports `match-size`.

`bring-to-front` and `send-to-back` are the exception to the paragraph above:
they accept any drawn element, including text, images, and icons, because they
change the order things are drawn in rather than where anything sits. A scene has
no depth other than that order, so these move the named elements, and everything
each of them owns, to the end or the beginning of it. They are applied after
every element exists, which means after connectors, so an element may be lifted
above a connector that joins others.

## 13. Styles and Themes

A document may define named styles and at most one theme:

```xdraw
diagram "Style precedence" {
  defaults: theme { font-family normal }
  important: style { stroke "#b91c1c"; background "#fee2e2" }
  alert: rectangle "Alert" { style important; stroke-width 3 }
}
```

Style precedence, from lowest to highest, is:

1. compiler defaults;
2. document theme;
3. constructor defaults;
4. named style; and
5. local element properties.

Applicable node style properties are `stroke`, `background`, `text-color`,
`stroke-width`, `stroke-style`, `fill-style`, `roughness`, `opacity`,
`font-family`, `title-size`, `body-size`, `line-height`, `link`, and `locked`.

Applicable free-text style properties are `text-color`, `font-family`,
`font-size`, `line-height`, `link`, `locked`, `auto-size`, and `wrap-width`.

Applicable freehand style properties are `stroke`, `background`,
`stroke-width`, `fill-style`, `roughness`, `opacity`, `link`, and `locked`.

`font-family` accepts `hand`, `handwritten`, `normal`, or `code`.
`stroke-style` accepts `solid`, `dashed`, or `dotted`. `fill-style` accepts
`solid`, `hachure`, or `cross-hatch`. Opacity is from 0 to 100. Links must use
`http`, `https`, or `mailto`.

## 14. Templates

Templates are document-scoped definitions:

```xdraw
diagram "Templates" {
  pair: template(name) {
    left: rectangle "${name} input"
    right: rectangle "${name} output"
    left -> right
  }

  orders: pair("Orders")
}
```

Template parameters are identifiers. Instance arguments bind positionally.
Every declared parameter must receive a value. `$parameter` substitutes a
complete property value; `${parameter}` interpolates into strings.

Expansion is hygienic. Definitions within an instance receive the instance ID
as a prefix, so the example produces `orders.left` and `orders.right`.
References between template-local definitions are rewritten to the expanded
IDs. Recursive template cycles are invalid.

## 15. Specialized Content

### 15.1 Text

`text` without `at` participates in layout. With `at`, it is positioned
absolutely. `align` accepts `left`, `center`, or `right`. `font-size` and
`wrap-width` must be positive.

### 15.2 Code

`code` requires exactly one string argument and permits only `language`,
`title`, `line-numbers`, and `highlight`. Line numbers default to `true` and
highlighting defaults to `false`. Highlighting supports `sql`, `typescript`,
and `xdraw`.

Code source is limited to 100,000 characters, 2,000 lines, and 10,000
characters per line. A compiler may fall back to plain editable monospace text
when highlighting exceeds its rendering budget.

### 15.3 Freehand

`freedraw` requires `at` and at least two distinct finite `points`. Points are
relative to `at`. It accepts no constructor arguments.

Optional `pressures` must contain either no values or one finite value from 0
to 1 per point. `simulate-pressure` defaults to `true` when pressures are
absent and `false` when they are present.

A freehand element may contain at most 5,000 points. A document may contain at
most 50,000 freehand points. Coordinate magnitudes may not exceed 1,000,000.

A `background` paints a freehand element only when its stroke closes, meaning
its first and last points lie within 8 units of each other. A `background` on a
stroke whose ends are further apart is invalid, because it would have no effect
in any renderer. A fill is drawn solid whatever `fill-style` requests when a
preview is rendered locally; `fill-style` is carried into the scene for the
editor to honour.

A node whose height is 40 or less and which carries a title or a body is
reported, as its label cannot fit inside it. Where a node is smaller than twice
its padding, the padding is reduced to fit rather than the element being
refused.

### 15.4 Assets and images

`asset` declares a relative file path or data URL. `image` and
`xdraw/assets.icon` reference an asset and require `at` and `size`.

Supported formats are PNG, GIF, JPEG, and SVG. SVG must not contain scripts,
event handlers, remote references, embedded active content, or CSS imports.
Default limits are 10 MiB per file, 25 MiB per document, and 8,192 pixels per
dimension.

### 15.4a Geometry references

Within an expression, `element.part` is a placed element's measured geometry.
The parts are `left`, `right`, `top`, `bottom`, `width`, `height`, `center_x`
and `center_y`. An element's own identifier may contain dots, so the last
segment is the part and everything before it is the element.

`along_x(stroke, u)` and `along_y(stroke, u)` give a point at fraction `u` of a
drawn stroke's length, measured by arc length rather than by parameter. `u` is
clamped to the range 0 to 1. Only a freehand stroke may be walked this way.

These names exist only after measurement and layout, so they may be used only
where resolution can wait that long: the `at` property of `text` and `freedraw`.
A node placed with `at` takes part in layout and so may not refer to a box that
layout has yet to place; a document that tries is invalid. Only elements that
layout places have geometry, so `text` and `freedraw` are not themselves
addressable.

Underscored names, `center_x`, `along_x`, are expression-level names, where a
hyphen would read as subtraction. Document-level property names remain
hyphenated.

### 15.5 Expressions and plotted curves

An expression is a closed sublanguage:

```text
expression = term, { operator, term }
term       = number | constant | name | call | "-", term | "(", expression, ")"
call       = function-name, "(", expression, { ",", expression }, ")"
operator   = "+" | "-" | "*" | "/" | "^"
constant   = "pi" | "tau" | "e"
name       = identifier, { ".", identifier }
```

A `name` is resolved by whichever part of compilation supplies it, per §7.3: a
`let` binding, a repeat's `index` or `count`, a template parameter, a placed
element's geometry, or, within `xdraw/math.plot`, the curve parameter `t`. A
name no stage supplies is invalid.

`^` is right-associative and binds more tightly than unary minus; the other
operators are left-associative. Function names are `sin`, `cos`, `tan`, `asin`,
`acos`, `atan`, `atan2`, `sqrt`, `abs`, `sign`, `floor`, `ceil`, `round`,
`min`, `max`, `exp`, `log`, and `hypot`, each with a fixed arity. There is no
assignment, control flow, or property access. An unknown name, an unknown
function, or a wrong argument count is invalid.

An expression may contain at most 512 terms and nest at most 64 levels deep.

`xdraw/math.plot` requires `at`, `x`, `y`, and `domain`, where `x` and `y` are
expressions and `domain` is an interval. Optional `tolerance` is the greatest
distance the emitted polyline may lie from the curve, in pixels, and defaults
to 0.5. A conforming compiler bounds each span of the curve rather than
sampling it, and invalidates a curve it cannot draw within that tolerance, 
including one whose value is unbounded on the domain, or whose coordinates
exceed the freehand magnitude limit.

## 16. Sequences and Annotations

An imported `seq.sequence` may contain only `seq.participant` declarations and
connections between those participants.

```xdraw
use "xdraw/sequence" as seq
use "xdraw/annotations" as annotations

diagram "Interaction" {
  flow: seq.sequence {
    user: seq.participant "User"
    api: seq.participant "API"
    user -> api "Submit"
    api -> user "Accepted"
  }
  note: annotations.note "Review response" { attach flow.api@bottom }
}
```

A note may attach to a target or be placed explicitly. An unanchored note must
be inside a lane, group, frame, or section. A callout is a warning-toned card
and uses ordinary connections when it needs to point at another element.

## 17. Hosted Scene Operations

### 17.1 Replace

```text
replace-operation = "replace", "{", diagram-document, "}"
```

Replace contains exactly one complete diagram document. It replaces the
managed scene content at the addressed resource.

```xdraw
scene excalidraw::default::architecture::overview {
  replace {
    diagram "System overview" {
      api: rectangle "API"
      data: ellipse "Data"
      api -> data
    }
  }
}
```

### 17.2 Patch

```text
patch-operation = "patch", "{", patch-action, { patch-action }, "}"
patch-action    = update-action | delete-action | add-action
update-action   = "update", identifier, property-block
delete-action   = "delete", identifier
add-action      = "add", "{", { import }, { statement }, "}"
```

A patch must contain at least one action. It may contain at most one `add`
block. A target may be updated once or deleted once, but not both. Additions
use normal diagram statements without an enclosing `diagram` declaration.

Update properties are:

| Text or identifier | Numeric |
|---|---|
| `tone`, `title`, `stroke`, `background`, `text` | `stroke-width`, `opacity`, `x`, `y`, `width`, `height`, `angle` |

Patch tones are `neutral`, `success`, `danger`, `warning`, `info`, and
`accent`.

```xdraw
scene excalidraw::default::architecture::overview {
  patch {
    update api { tone warning; title "API v2" }
    delete legacy
    add { review: rectangle "Requires review" { at (80, 80) } }
  }
}
```

## 18. Processing Model

A conforming compiler processes a diagram in this order:

1. tokenize source and retain source locations;
2. parse one document form;
3. resolve imports, constructors, scopes, and references;
4. expand templates with hygienic IDs;
5. validate semantic constraints and assets;
6. prepare generated assets such as highlighted code and formula SVG;
7. measure content and apply automatic layout;
8. apply precision geometry and route connections; and
9. emit native editable Excalidraw elements.

The same valid source, compiler version, fonts, assets, and compilation options
should produce semantically equivalent scene content. Generated element IDs
must remain stable enough for source-addressed scene patching.

A compiler must not publish a partial hosted replacement or patch after a
validation failure.

## 19. Diagnostics

Syntax diagnostics should identify the unexpected token and its source
location. Semantic diagnostics should identify the violated invariant and,
when available, the originating declaration.

Errors prevent successful compilation. Warnings communicate modelling quality
or portability concerns without changing the validity of the document.

## 20. Language Evolution

Additions to the language must preserve these principles:

- a small set of orthogonal drawing primitives;
- explicit identity and deterministic reference resolution;
- semantic libraries layered on primitives rather than hidden syntax;
- readable source that remains useful without an editor;
- editable native Excalidraw output; and
- fail-closed validation for ambiguous or lossy behavior.

New syntax must be documented here before it is considered part of the stable
language. User-facing examples belong in the
[tour](tour.md); this specification remains the
authoritative behavioral contract.
