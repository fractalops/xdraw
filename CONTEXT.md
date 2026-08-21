# XDraw domain context

The vocabulary this codebase uses, and where each concept lives.

`docs/spec.md` is normative for the *language*. This file is normative for the
*names* — it exists so structural decisions are made against recorded
vocabulary instead of re-argued. When a term here conflicts with a filename,
the filename is wrong.

## Document forms

**Diagram document** — a `diagram "…" { … }` source file. Compiles locally to a
Drawing. The common case.

**Scene document** — a `scene …` source file describing a *replace* or *patch*
against a hosted Excalidraw scene. Not a diagram; it carries an operation and a
target resource. See `docs/spec.md` §5.2, §17.

**Semantic document** — the compiler's nominal, internal intermediate
representation. Produced by lowering and consumed by prepared compilation.
Everything before it works in source terms; everything after works in geometry.
Type `SemanticDocument`, built and cloned only through `language/semantic.ts`.
The public `compile()` accepts a `DiagramDocument`, never this internal stage.

**Drawing** — the output. A validated set of native Excalidraw elements plus
embedded asset files, diagnostics, and compilation measurements. Class
`Drawing`.

**Compilation measurements** — structured facts about the final compiled
scene: bounds, centers, paths, connector and label geometry, container slack,
resolved constraints, text runs, and assets. Produced after native emission,
stored non-enumerably on `Drawing.measurements`, and never serialized into the
Excalidraw document. `check` is their CLI presentation surface.

## The pipeline

`docs/spec.md` §18 defines nine processing steps. The directory layout follows
them:

| Spec step | Lives in |
|---|---|
| 1. tokenize | `language/tokenizer.ts` |
| 2. parse one document form | `language/parser.ts` |
| 3. resolve imports, constructors, scopes, references | `language/registry.ts`, `language/manifests/` |
| 4. expand repetition and templates with stable, hygienic IDs | `language/repetition.ts`, `language/expander.ts`, `language/identity.ts` |
| 5. validate semantic constraints and assets | `language/semantic.ts`, `language/validator.ts`, `io/assets.ts` |
| 6. prepare generated assets | `text/syntax-highlighter.ts`, `nodes/math/` |
| 7. measure content and apply automatic layout | `compile/measurement.ts`, `layout/` |
| 8. solve final geometry and route connections | `compile/final-geometry.ts`, `layout/constraints.ts`, `compile/geometry-pass.ts`, `routing/` |
| 9. emit native editable Excalidraw elements | `compile/render.ts`, `excalidraw/` |

`compile/pipeline.ts` is the driver that sequences these. It is not "the
compiler" — no single module is.

Steps 6 and 7 are why the public `compile()` is asynchronous: highlighting,
formula rasterisation, and ELK layout are resolved first and passed into the
deterministic renderer. `compilePrepared()` is an internal synchronous test
seam for documents that require none of that preparation.

## Terms that have collided

These are the distinctions that have actually caused confusion. Keep them.

**Geometry** means two different things, and both are legitimate:
- *geometry primitives* — `geometry.ts` at src root: `box`, `inset`, `row`,
  `column`, `anchor`, `alignBounds`, `distributeBounds`. Pure functions over
  `Bounds`. Used by layout, routing, and compilation.
- *geometry statements* — the precision-placement statements (`alignment`,
  `distribution`, `offset`, `match-size`, `rotation`, `snap`) planned by
  `compile/geometry-pass.ts` **after** automatic layout and before Excalidraw
  emission. Spec §12.

Layout supplies strong stays; precision statements become required relations in
one constraint solve. A node position relative to an earlier placed box is also
a required relation in that solve. Contradictory requirements fail rather than
depending on statement order.

**Scene transform** is the final affine transform from measured visual bounds
to solved visual bounds, plus rotation. It is structured-clone-safe data on a
`SceneVisual`. The constraint module plans it; the Excalidraw adapter applies it
while emitting that visual's native elements. Compiler modules never find and
mutate emitted elements by identifier.

**Final geometry plan** is the ordered, renderer-independent result of box
constraints, path dependencies, attachments, rotation envelopes, and sampled
stroke transforms. `compile/final-geometry.ts` is its single orchestration seam;
the `SceneGraph` must contain every routable visual before routing or native
emission begins.

**Layout flow** is the renderer-independent separation between two ordered
groups emitted by a layout adapter: horizontal siblings, vertical rows, or
successive sections. The constraint module preserves these gaps while enlarging
containers and moving downstream groups. Layout flow belongs to `SceneGraph`;
it is not an Excalidraw concept.

Which kinds count as geometry statements is written once: the type
`GeometryStatementKind` in `contracts/foundation.ts`, and its runtime companion
`GEOMETRY_STATEMENT_KINDS` in `language/geometry-statements.ts`, which uses
`satisfies` so neither can gain a kind without the other. Both IR stages share
the type. Adding a kind is those two edits plus the pass that acts on it; it
used to be five, and a stage left out dropped the statement without a word.

**Math and formula** are the same concept at different scales. The language
surface is `math.formula` (library `xdraw/math`), so the directory is
`nodes/math/` and the document-level planner is `formula.ts`. Every exported
symbol uses `Formula…`. Do not reintroduce a `math-` filename prefix.

**Scale** means the data-only mapping and tick plan in `math/scales.ts`: an
input data domain, an effective mapping domain, a physical range, and measured
labels. **Axis** means the renderer-independent line, mark, and label geometry
derived from a scale. Tick selection belongs to the scale module; renderers do
not choose, filter, or reposition ticks. Scale and axis plans must remain
`structuredClone`-safe.

**Coordinate plane** means the `math.plane` rich node that owns two scales,
their axes, optional grid and zero crossings, and one or more nested `math.plot`
series. The plane may declare its visible coordinates with `x in [a, b]` and
`y in [c, d]`, or infer a missing interval from finite plot enclosures. A plot
declares one independent variable over a closed interval, or inherits `x` or
`y` from the plane for an ordinary function;
when that variable is `x` or `y`, its matching coordinate expression is
implicit. The Cartesian planner
samples it to a pixel tolerance, maps it through the effective scale domains,
clips it to the plot viewport, and hands native line geometry to the renderer.
An implicit plot is the zero set of an equation in `x` and `y`; it requires an
explicit viewport and is traced by `math/implicit.ts`.
Standalone `math.plot` remains a drawing-space freehand curve and requires `at`.

**Node** means three things — always qualify:
- a *node statement* in the source (`a: rectangle "A"`)
- a *rich node* — a node whose content needs its own planner and renderer
- an *element* — the Excalidraw output primitive. Never call an element a node.

**Adapter** means two unrelated things:
- a *layout adapter* — `BUILTIN_LAYOUT` or `LAYERED_LAYOUT`, satisfying the
  layout seam in `compile/scene.ts`
- `excalidraw/adapter.ts` — emission into the target format

Say "layout adapter" or "the Excalidraw adapter". Never bare "adapter".

**Scene** means three things:
- `SceneGraph` — the mutable in-flight structure during compilation
- *scene document* — the hosted-scene source form above
- an Excalidraw *scene* — what the editor loads

## Rich node families

`nodes/rich-nodes.ts` dispatches on `node.kind` over exactly four families:

| Family | Implementation |
|---|---|
| `formula` | `nodes/math/formula.ts` |
| `cartesian` | `nodes/cartesian.ts` |
| `table` | `nodes/table.ts` |
| `architecture` | `nodes/architecture.ts` |

Adding a family means adding it to `RICH_NODE_FAMILIES` — the registry is the
single dispatch seam, reached through `Measurer.planRichNode`. Note that **code
blocks are not a rich node family**: `text/code-block.ts`
is consumed directly by measurement, layout, and the Excalidraw adapter.

## Sections

A *section* is any statement that contains other statements and gets laid out
as a unit: `code`, `frame`, `group`, `lane`, `section`, `sequence`, `tree`
(`layout/sections.ts`, `SECTION_TYPES`). "Frame" is one section kind, not a
synonym for the category.

## Standard libraries

Imported with `use "xdraw/…"`. Manifests in `language/manifests/`:
`xdraw/core`, `xdraw/architecture`, `xdraw/annotations`, `xdraw/assets`,
`xdraw/connectors`, `xdraw/math`, `xdraw/palette`, `xdraw/process`,
`xdraw/sequence`, `xdraw/table`.

## Structural rules

**Published entry points stay at `src/` root.** `index.ts`, `browser.ts`,
`xdraw.ts`, and `excalidraw-api.ts` map to paths in `package.json` exports.
Moving one changes the published layout.

**Compiler stages and layout machinery are internal.** The package exposes
source parsing, universal asynchronous compilation, drawings, manifests, math
plans, and low-level Excalidraw constructors. `SemanticDocument`, `SceneGraph`,
measurers, style resolvers, and layout adapters are implementation seams rather
than promises to package consumers.

**Contracts are types-only.** The seven modules in `contracts/` contain zero
runtime exports. This is what keeps the module graph free of runtime cycles —
they are a cross-cutting layer, not part of any subsystem. Inlining them into
the modules that own them would knot the graph immediately.

**A directory means a cohesive subsystem**, not a topic. Flat is the default.

## Workers

`platform/worker-host.ts` is the single seam for running a module in a worker.
ELK layout and formula rendering both use it.

**Browser worker construction stays at the call site.** Bundlers only detect a
worker when they can statically see
`new Worker(new URL("./worker-browser.js", import.meta.url), { type: "module" })`.
Computing that URL in a helper silently produces a worker that never loads —
the page hangs rather than erroring. The shared host therefore takes a thunk
containing that literal, and only owns detection, the Node adapter, and the
lifecycle surface.

Use `.js` in the browser literal even though the source is `.ts`: the bundler
resolves it back to source in development, and it is already correct in the
published package. Node specifiers are computed from the caller's own extension
(`nodeWorkerUrl`), which is safe because the Node path is never bundled.

Environment detection is `process.versions.node`, never `typeof Worker`. Node
keeps adding web globals, so absence of `Worker` is not a reliable signal.

## Semantic validation

`language/semantic.ts` holds `VALIDATION_RULES`, a frozen array of semantic
families applied to every statement in order.

**Array order is the observable contract.** It determines the order of the
returned diagnostics, which is neither source order nor code order. A rule may
return `true` to halt the remaining rules for its statement; only
`geometry-selection` does, because a malformed selection makes every later
geometry check meaningless.

**Two validators run, and both are load-bearing.** `language/validator.ts`
checks documents against the library manifests — constructor names, property
names and types, arity — and throws `LanguageValidationError` before semantic
validation is reached. `validateSemanticDocument` checks semantic constraints:
cross-references, cardinality, containment, and value ranges. The internal
`buildSemanticIR` boundary always runs the latter; the nominal stage type stops
ordinary callers from fabricating an indexed semantic tree with stale object
maps. All rules remain independently testable against compiler-owned IR.

Each rule has a test in `test/semantic-diagnostics.test.ts`, built against the
IR directly. Add a rule, add a case, and update the count assertion there.

## Diagnostics

A **diagnostic** carries a code, a severity, a message, a location, and the facts
the message was built from: `subjects` (element ids), `measures` (numbers keyed by
a closed vocabulary), `suggestion` (source that clears it). The message is for a
person; the fields are for everything else.

A **remark** is the third severity, alongside error and warning. It reports what
the compiler decided rather than something wrong, and it is opt-in, because every
container produces one and a document with sixty would bury its warnings.

A **measure** is one of `requested`, `resolved`, `required`, `available`. Closed,
so two codes cannot name the same quantity differently. `required` for a
container includes its heading band, which makes `available - required` exactly
the space left below its last child.

**Slack** is that difference. `corpus/container-slack.json` records the
containers whose slack exceeds a budget, and the list may only shrink.

## Settled constraints

- **Connector labels never detach.** Placement lives in `routing/labels.ts`.
  When neither side of the longest route leg fits, placement fails with XD2002
  and clearance layout must reserve the required space. Labels also treat other
  planned connector paths as obstacles, so a stroke cannot pass through a label
  and change which relationship it appears to describe.
- **`distributeBounds` is exactly idempotent.** Focused and property tests cover
  both separated and overlapping mixed-size bounds.
- **A node's label defaults to its id.** `dot: ellipse { size = (10, 10) }` is
  labelled `dot`, so an omitted label is not an absent one and the size rules
  still apply. An empty string is how a document asks for no label.
- **A diagnostic code names one condition.** XD1211 is the layout spacing
  conflict and XD1246 is the node-height rule.
