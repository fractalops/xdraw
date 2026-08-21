# Architecture

This page is a primer for contributors who need to navigate the compiler. It
follows a document from source text to an Excalidraw scene, naming the module
that owns each step so you can read the code alongside it.

The [language specification](spec.md) defines what the language means. This page
describes where and how the compiler implements it.

The diagrams are generated from runnable examples under
[`examples/`](../examples/); the test suite compiles them and
`npm run docs:images` regenerates the images.

## Compilation flow

![The XDraw compilation pipeline](images/compilation-pipeline.png)

The boxes are the artifacts that exist at each point. The arrows are the
transformations between them. Each is described below in the order it runs.

`SemanticDocument` is the seam. Everything before it works in source terms, 
tokens, spans, constructors, templates. Everything after works in geometry, 
measured text, positioned bounds, routed connectors. Most changes belong
entirely on one side of it, so identifying the side first narrows the search.
Positions that legitimately wait for layout use the explicit `DeferredPoint`
contract; renderable freehand and text paths narrow that value to a finite
`Point` at the adapter boundary. `SemanticDocument` is a nominal internal stage,
so public callers cannot bypass expansion and indexing with a hand-built tree.
The internal prepared seam still clones semantic input before resolving it.

## Entry points

[`src/compile/pipeline.ts`](../src/compile/pipeline.ts) sequences the stages and
does nothing else. No single module is "the compiler".

It exports one public entry point. `compile` resolves syntax highlighting,
formula rasterisation, and ELK placement asynchronously, then hands the prepared
inputs to the deterministic renderer. A deep `compilePrepared` export exists
only as an internal test seam for inputs that require no preparation.

The asynchrony sits at the edges. Rendering itself is pure, which is why scene
output is reproducible.

Precision geometry is solved as a simultaneous linear constraint system in
[`src/layout/constraints.ts`](../src/layout/constraints.ts). Measured layout is
a strong stay; align, distribute, match-size, offset, and snap statements are
required relations inserted in canonical semantic-ID order. A relative node
position is another required relation in that same solve. Its parsed affine
form is plain clone-safe data. Semantic validation indexes the complete scope,
orders forward and backward references as a dependency graph, and reports a
cycle before the solver runs. Built-in layout also records
renderer-independent layout flows between ordered groups. Containment and flow
relations let the solver enlarge containers, propagate growth through ancestors,
and reflow following groups before anything is emitted. Contradictory
requirements fail explicitly. Rotation is nonlinear and runs after the linear
solve, but is recorded as a scene transform before emission. Layer ordering
remains the final rendering operation because Excalidraw represents depth by
element-array order.

Linear scales and axes form a separate, renderer-independent math module in
[`src/math/scales.ts`](../src/math/scales.ts). `planLinearScale` jointly scores
numeric simplicity, coverage, requested density, and measured label legibility.
A winning covering candidate expands the effective domain, while an inside
candidate keeps the data domain, so every tick remains inside the physical
range. `planLinearAxis` owns the corresponding line, tick-mark, label-position,
and alignment geometry. Both plans are plain data and survive
`structuredClone`; renderers consume them without reimplementing tick policy.
The `cartesian` rich-node family composes those plans with nested `math.plot`
descriptions. It infers omitted coordinate intervals from interval enclosures,
converts pixel tolerance into data-space tolerance before sampling, maps through
both effective scales, clips polylines at the viewport, and stores only
target-independent geometry in its rich plan. Implicit zero sets are traced by
[`src/math/implicit.ts`](../src/math/implicit.ts) inside an explicit viewport.
The Excalidraw adapter emits all planned curves as native line elements.

[`src/cli.ts`](../src/cli.ts) is the other way in. It parses arguments, reads a
file or standard input, and calls `compile`.

## Tokenizing and parsing

[`src/language/tokenizer.ts`](../src/language/tokenizer.ts) turns source text
into tokens that retain their offsets, so every later diagnostic can name a line
and column.

[`src/language/parser.ts`](../src/language/parser.ts) has two halves.
`parseSyntax` builds a `SourceDocument`, structure without meaning.
`lowerSyntax` then resolves that against the library manifests and produces a
`DiagramDocument`. `parseSource` runs both.

Source values are recursive data. The tokenizer distinguishes mathematical
expressions from tuple structure without consulting a property-name list; the
selected constructor manifest later decides whether a tuple is a point, a list
of points, numbers, or strings. Template parameter inference follows that same
structure, including parameters nested in point expressions.

The manifests live in
[`src/language/manifests/`](../src/language/manifests/): `contracts.ts` holds
the types, `schema.ts` validates a manifest at load, and `builtins.ts` holds the
standard libraries XDraw ships.

## Validating against the language

[`src/language/validator.ts`](../src/language/validator.ts) checks a document
against those manifests: constructor names, property names and kinds, argument
arity, and child rules. It throws `LanguageValidationError` on the first
problem, before any semantic work begins.

This is the stage that produces "unknown constructor" and "does not accept
property" messages, including their suggestions.

## Expanding and lowering

[`src/language/deferred.ts`](../src/language/deferred.ts) holds the one idea
that `let` bindings, a repeat's index, a template parameter and a measured box
all share: a name whose value someone supplies later. Each stage calls `advance`
with the names it knows, and only the last stage that could have supplied a name
calls `demand` and turns what is left into a diagnostic.

A pending value is a plain string, which is load-bearing rather than lazy: an
opaque representation does not survive the `structuredClone` that repetition and
template expansion both use, and a cloned value came back looking resolved.

[`src/language/repetition.ts`](../src/language/repetition.ts) turns a repeated
declaration into its instances, before templates expand: so a repeat may use a
template, and everything after sees ordinary declarations. Children expand
before their parent, because an inner repeat's position mentions its own index.
It also expands a geometry selection of the declaration into the instance IDs,
keeping collection behavior on the source side of the Semantic document seam.

[`src/language/expander.ts`](../src/language/expander.ts) inlines templates and
gives the expanded declarations hygienic identifiers, so two uses of one
template cannot collide.

[`src/language/semantic.ts`](../src/language/semantic.ts) lowers the expanded
AST into a `SemanticDocument`: it lowers decision branches, indexes every
object and reference, and runs `validateSemanticDocument`.

That validator is a frozen array of rule families applied to each statement.
**Array order is part of the contract**: it determines the order diagnostics
appear in, which `test/semantic-diagnostics.test.ts` pins.

## Expressions and plotted curves

[`src/language/expression.ts`](../src/language/expression.ts) is a bounded
expression sublanguage, eighteen functions, three constants, five operators,
and one free variable bound by the caller. It follows Vega's restriction list:
no assignment, no control flow, no property access. It is reachable from one
constructor and is not the language growing general expressions.

Two size limits bound it, and they catch different shapes. `MAXIMUM_NESTING`
bounds parser recursion, which is what a deep chain of parentheses exhausts.
`MAXIMUM_NODES` bounds the tree, which is what a long left-associative chain
exhausts, `t+1+1+1…` is consumed by a loop rather than by recursion, so the
parser never nests while the tree grows one level per term, and the stack then
overflows in the evaluator rather than in the parser.

[`src/language/interval.ts`](../src/language/interval.ts) evaluates the same
expressions over an interval rather than at a point, producing a range that
contains every value the expression takes across it.

[`src/language/curve-sampler.ts`](../src/language/curve-sampler.ts) uses that to
turn a pair of expressions into a polyline. **Its tolerance is a bound, not an
estimate**, and that distinction is the reason the interval module exists, 
see the constraints below.

`math.plot` lowers to a *description*: its equations, independent variable,
closed interval and tolerance.
For a standalone plot, [`src/compile/plot-pass.ts`](../src/compile/plot-pass.ts)
draws it into a `freedraw` statement afterwards. Inside `math.plane`, the
description remains nested for the Cartesian planner to sample in data space. The
split matters: the pass runs after
templates expand, so a template may supply a value to an equation, and before
the document is validated, so the freehand limits apply to a plotted curve
exactly as they do to a drawn one. Sampling in the parser froze a curve before
the template could reach it.

`let` bindings resolve in [`src/language/bindings.ts`](../src/language/bindings.ts)
and are folded into the document by `lowerSyntax`. They are constants, so this
happens while the document is read; an expression that still holds a name
another binder supplies keeps its expression with the known parts substituted.

## Measuring and placing

[`src/compile/scene.ts`](../src/compile/scene.ts) builds the `SceneGraph` that
the rest of compilation mutates, and `layoutWithAdapter` dispatches to a layout
adapter after checking the document's requirements against that adapter's
capabilities.

[`src/compile/measurement.ts`](../src/compile/measurement.ts) sizes content
before it can be placed, using the font metrics in
[`src/text/`](../src/text/). Its nested grid plan is shared by measurement and
placement, so both agree on cell widths, row heights, and overflow failure.

[`src/layout/`](../src/layout/) holds the adapters: `builtin.ts` for rows,
columns, grids, and trees, and `layered.ts` for flat graphs via ELK. The ELK
integration runs in a worker; see [`src/layout/elk/`](../src/layout/elk/).

[`src/compile/geometry-references.ts`](../src/compile/geometry-references.ts)
resolves detached `text`, plot, and freehand positions that name another
element's geometry, against the final boxes layout and precision geometry have
produced. Expression function signatures live with the expression language, so
path arguments and point/number results are checked before sampled geometry is
available. Attachment and detached-position planning reject stale reads from
paths that are late-bound, transformed, or themselves attached.

[`src/compile/geometry-pass.ts`](../src/compile/geometry-pass.ts) collects
relative node positions and precision-geometry statements. Linear relations are
solved together after automatic layout, whose bounds act as strong stays. The
same solve admits node-to-fixed-path attachments after their target point has
been sampled; containers can therefore grow and following groups can reflow.
Prepared adapter routes are invalidated whenever precision geometry changes
bounds, so routing consumes the final positions rather than stale waypoints. The
result updates `SceneGraph` visuals before the Excalidraw adapter emits them;
compound nodes that change size retain their measured plan and carry a scene
transform from measured to solved bounds. Detached freehand bounds are derived
directly from their points and enter the same pre-emission planning path.
Rotation is accumulated into the transform and its final AABB is registered
before geometry references and routing consume it.

[`src/compile/final-geometry.ts`](../src/compile/final-geometry.ts) owns the
ordering across those operations. It solves box geometry, resolves stable path
dependencies, applies attachments, plans detached strokes, and records their
transformed samples. This is the one final-geometry seam called by rendering;
routing never has to guess whether a visual has been planned yet.

[`src/routing/`](../src/routing/) routes connectors around the placed nodes and
positions their labels.

## Emitting

[`src/compile/render.ts`](../src/compile/render.ts) drives the whole back half
and produces a `Drawing`. Measurement and layout build the `SceneGraph`, the
final-geometry seam completes it, and only then do routing and native emission
consume it.

[`src/excalidraw/`](../src/excalidraw/) owns the target format: the `Drawing`
document, element and component constructors, and the adapter that turns scene
visuals into native elements. The adapter applies each planned scene transform
as part of emitting that visual. Final front/back operations also live at this
target-format seam; no compiler module mutates emitted geometry.

[`src/nodes/`](../src/nodes/) handles content that needs more than a shape:
`rich-nodes.ts` dispatches by node kind to the formula, table, and architecture
families, with the math subsystem under `nodes/math/`.

## Reporting

Compilation preserves two kinds of non-scene metadata on `Drawing`.
`measureCompilation` in
[`compile/measurement-report.ts`](../src/compile/measurement-report.ts) reads
the final `SceneGraph` and emitted native elements together, so it can retain
semantic bounds and constraints alongside actual stroke points, connector
routes, labels, text, and assets. The structured result lives on the
non-enumerable `Drawing.measurements` property. Like diagnostics, it is absent
from `toJSON()` and cannot change an Excalidraw fingerprint.

[`io/measurement-report.ts`](../src/io/measurement-report.ts) is the presentation
boundary for this record. `check` renders it to standard output as text or one
JSON document. `build` and `apply` keep it available to API callers but do not
print it. This keeps compilation responsible for facts and the CLI responsible
for presentation.

A diagnostic is a record rather than a sentence.
[`contracts/foundation.ts`](../src/contracts/foundation.ts) gives it a code, a
severity, a message, a location, and three optional fields that carry the facts
the message is built from:

| field | holds |
| --- | --- |
| `subjects` | the element ids the diagnostic is about, in the order the message names them |
| `measures` | the numbers behind it, keyed by a closed vocabulary |
| `suggestion` | source a document can accept unchanged to clear it |

`DiagnosticMeasure` is closed on purpose, currently `requested`, `resolved`,
`required` and `available`: a value the author asked for against the value the
compiler used, and space content needs against the space it has. Four names cover
every numeric diagnostic in the tree, and a fifth is a deliberate edit to one
union rather than a local choice at a call site. Without that, forty codes invent
forty synonyms for the same quantity.

The point of the split is that the numbers were always computed and then
destroyed. XD2001 knew both gaps; XD2005 knew how wide a code block needed to be
and printed only how wide it was allowed to be. A consumer had to parse English
to recover either.

`suggestion` is machine-applicable, and `test/diagnostic-data.test.ts` proves it
by splicing XD2006's suggestion into a document, recompiling, and asserting the
diagnostic is gone. That is the property a `--fix` mode would rest on.

**Three severities.** `error` and `warning` mean what they usually do. `remark`
is informational: a record of what the compiler decided, rather than something
wrong. Remarks are opt-in, and the gate is at the call site rather than inside
the collector, so a skipped pass never builds its message strings. XD3001 is the
first, reporting what each container reserved against what its contents occupy;
sixty-six of them in a document would bury its warnings, which is why the default
is silence. See [`compile/container-report.ts`](../src/compile/container-report.ts).

**Rendering is a consumer.** `renderDiagnostics` in
[`io/diagnostics.ts`](../src/io/diagnostics.ts) is the only place a run of
diagnostics becomes text, in one of two presentations: prose, or one JSON object
per line carrying every field plus the prose as `rendered`. Compilation never
formats anything. This is not one of the seams in the table below and should not
be added to it: a third presentation means editing `renderDiagnostics`, not
registering an adapter. It is a boundary between producing a diagnostic and
presenting one, which is a weaker and cheaper thing.

## Module layers

![XDraw module layers](images/module-layers.png)

Dependencies point downward. The four most imported modules are in
[`src/contracts/`](../src/contracts/) and hold types only, so TypeScript erases
those imports and they cost nothing at run time. That is what keeps the module
graph free of runtime cycles.

Keep shared types in `contracts/`. Moving them into the modules that use them
converts type-only edges into runtime edges and makes cycles easy to introduce.

Modules named in the package `exports` map, `index.ts`, `browser.ts`,
`xdraw.ts`, `excalidraw-api.ts`, stay at the `src/` root, because moving one
changes the published package layout.

## Extension points

![XDraw extension seams](images/extension-seams.png)

Four seams, each with two or more existing implementations:

| seam | declared in | implementations |
| --- | --- | --- |
| layout adapter | [`compile/scene.ts`](../src/compile/scene.ts) | `BUILTIN_LAYOUT`, `LAYERED_LAYOUT` |
| rich node family | [`nodes/rich-nodes.ts`](../src/nodes/rich-nodes.ts) | formula, cartesian, table, architecture |
| worker host | [`platform/worker-host.ts`](../src/platform/worker-host.ts) | node, browser |
| file system | [`io/filesystem.ts`](../src/io/filesystem.ts) | rooted, in-memory |

These are internal module seams, not all published extension interfaces. In
particular, layout adapters operate on the mutable compiler `SceneGraph` and are
kept out of the package entry point until that contract can be made independent
of compiler internals.

Prefer adding an implementation behind an existing seam. Introduce a new one
only when a second concrete use exists, one implementation is a hypothetical
seam, two is a real one.

## Constraints worth knowing

- Diagnostics and compilation measurements are absent from `toJSON()`. They
  live on `Drawing` as non-enumerable properties, so reporting-only changes do
  not move corpus fingerprints.
- A diagnostic code identifies one condition. XD1211 is the layout spacing
  conflict; XD1246 is the node-height rule.
- Validation-rule order is observable. It sets the order of returned
  diagnostics.
- Browser worker construction must stay a literal. Bundlers only detect a
  worker when they can see `new Worker(new URL("./worker-browser.js",
  import.meta.url))` written out. Computing that URL produces a page that hangs
  with no error.
- `contracts/` holds types only. See the module-layer section above.
- Two validators run, and both are load-bearing. `language/validator.ts`
  checks documents against manifests; `validateSemanticDocument` checks semantic
  constraints while building the compiler-owned semantic stage. Public
  `compile` accepts only a `DiagramDocument`.
- Code has its own size budget, larger than the one for display text. See
  [`src/text/policy.ts`](../src/text/policy.ts).
- Property names are global. [`src/language/registry.ts`](../src/language/registry.ts)
  builds one name-to-kind map across every constructor in every library, and
  throws at load if two constructors give the same property name different
  kinds. Reusing a name means accepting its existing kind.
- A curve sampled to a tolerance is bounded, not estimated. Subdividing
  until a few interior samples look close enough says nothing about the points
  between them; measured against curves of high frequency that approach
  exceeded its stated tolerance by up to twenty seven times and reported
  success. Enclosing each span with interval arithmetic makes flatness provable,
  because distance to a segment is convex and a box is convex, so the maximum is
  attained at a corner. The same enclosure is what finds poles and what checks
  the magnitude limit, so all three are one mechanism rather than three. The
  bounds use double precision without directed rounding, so the guarantee holds
  to within floating-point error in the bounds themselves.
- Interval rules must over-estimate, never under-estimate. A range that is
  too wide costs subdivision; a range that is too narrow silently produces a
  wrong curve. Where a tight rule would be fiddly, `atan2` across its branch
  cut, a fractional power of a negative base: the rules widen to the whole line
  and let the caller subdivide.

## Reference card

![XDraw architecture reference](images/architecture-cheatsheet.png)

A single-page summary of the above: the specification's
[nine processing steps](spec.md) mapped to their modules, the directory layout,
the seams, and the constraints.

## Testing

- `npm test` runs the Node suite.
- `npm run test:browser` runs Playwright acceptance tests against a packaged
  build.
- `npm run test:types` checks the published type declarations.
- `test/corpus.test.ts` pins compiled output by fingerprint. When it fails,
  inspect the scene diff before accepting a new fingerprint: the failure means
  output changed, not that the test is stale.
