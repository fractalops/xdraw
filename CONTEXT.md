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

**Semantic document** — the intermediate representation. Produced by lowering,
consumed by compilation. This is the seam between the front end and the back
end: everything before it works in source terms, everything after works in
geometry. Type `SemanticDocument`, built by `buildSemanticIR`.

**Drawing** — the output. A validated set of native Excalidraw elements plus
embedded asset files and diagnostics. Class `Drawing`.

## The pipeline

`docs/spec.md` §18 defines nine processing steps. The directory layout follows
them:

| Spec step | Lives in |
|---|---|
| 1. tokenize | `language/tokenizer.ts` |
| 2. parse one document form | `language/parser.ts` |
| 3. resolve imports, constructors, scopes, references | `language/registry.ts`, `language/library-manifest.ts` |
| 4. expand templates with hygienic IDs | `language/expander.ts`, `language/identity.ts` |
| 5. validate semantic constraints and assets | `language/semantic.ts`, `language/validator.ts`, `io/assets.ts` |
| 6. prepare generated assets | `text/syntax-highlighter.ts`, `nodes/math/` |
| 7. measure content and apply automatic layout | `compile/measurement.ts`, `layout/` |
| 8. apply precision geometry and route connections | `compile/geometry-pass.ts`, `routing/` |
| 9. emit native editable Excalidraw elements | `compile/render.ts`, `excalidraw/` |

`compile/pipeline.ts` is the driver that sequences these. It is not "the
compiler" — no single module is.

Steps 6 and 7 are why `compileAsync` exists: highlighting, formula
rasterisation, and ELK layout are asynchronous, so they are resolved first and
passed into an otherwise synchronous render.

## Terms that have collided

These are the distinctions that have actually caused confusion. Keep them.

**Geometry** means two different things, and both are legitimate:
- *geometry primitives* — `geometry.ts` at src root: `box`, `inset`, `row`,
  `column`, `anchor`, `alignBounds`, `distributeBounds`. Pure functions over
  `Bounds`. Used by layout, routing, and compilation.
- *geometry statements* — the precision-placement statements (`alignment`,
  `distribution`, `offset`, `match-size`, `rotation`, `snap`) applied by
  `compile/geometry-pass.ts` **after** automatic layout. Spec §12.

Layout *proposes* positions; the geometry pass *overrides* them.

**Math and formula** are the same concept at different scales. The language
surface is `math.formula` (library `xdraw/math`), so the directory is
`nodes/math/` and the document-level planner is `formula.ts`. Every exported
symbol uses `Formula…`. Do not reintroduce a `math-` filename prefix.

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

`nodes/rich-nodes.ts` dispatches on `node.kind` over exactly three families:

| Family | Implementation |
|---|---|
| `formula` | `nodes/math/formula.ts` |
| `table` | `nodes/table.ts` |
| `architecture` | `nodes/architecture.ts` |

Adding a family means adding it to `RICH_NODE_FAMILIES` — the registry is the
seam. Note that **code blocks are not a rich node family**: `text/code-block.ts`
is consumed directly by measurement, layout, and the Excalidraw adapter.

## Sections

A *section* is any statement that contains other statements and gets laid out
as a unit: `code`, `frame`, `group`, `lane`, `section`, `sequence`, `tree`
(`layout/sections.ts`, `SECTION_TYPES`). "Frame" is one section kind, not a
synonym for the category.

## Standard libraries

Imported with `use "xdraw/…"`. Manifests in `language/library-manifest.ts`:
`xdraw/core`, `xdraw/architecture`, `xdraw/annotations`, `xdraw/assets`,
`xdraw/connectors`, `xdraw/math`, `xdraw/palette`, `xdraw/process`,
`xdraw/sequence`, `xdraw/table`.

## Structural rules

**Published entry points stay at `src/` root.** `index.ts`, `browser.ts`,
`xdraw.ts`, and `excalidraw-api.ts` map to paths in `package.json` exports.
Moving one changes the published layout.

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
cross-references, cardinality, containment, value ranges. The overlap is
deliberate: `compile()` accepts a `SemanticDocument`, so a caller can bypass
the parser entirely and hand over IR it built itself. All 59 rules are
reachable that way, so none are redundant.

Each rule has a test in `test/semantic-diagnostics.test.ts`, built against the
IR directly. Add a rule, add a case, and update the count assertion there.

## Known divergences

Recorded so they are not mistaken for settled design:

- **`compile()` is partial.** It throws for documents containing formulas
  because the "formulas already resolved" precondition is not in the type.
- **Rich-node planning has two dispatch paths.** `registerRichNodePlanner` adds
  a measurer-keyed override with exactly one registration site.
- **`distributeBounds` is not idempotent** in one narrow case: when the
  overlap branch widens the extent enough to flip the gap sign, a second call
  takes the other branch. Compilation is single-pass, so output is unaffected.
