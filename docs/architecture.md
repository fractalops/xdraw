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

`SemanticDocument` is the seam. Everything before it works in source terms —
tokens, spans, constructors, templates. Everything after works in geometry —
measured text, positioned bounds, routed connectors. Most changes belong
entirely on one side of it, so identifying the side first narrows the search.

## Entry points

[`src/compile/pipeline.ts`](../src/compile/pipeline.ts) sequences the stages and
does nothing else. No single module is "the compiler".

It exports two entry points:

- `compile` renders synchronously.
- `compileAsync` first resolves the three inputs that cannot be produced
  synchronously — syntax highlighting, formula rasterisation, and ELK placement
  — then hands the results to the same renderer.

The asynchrony sits at the edges. Rendering itself is pure, which is why scene
output is reproducible.

[`src/cli.ts`](../src/cli.ts) is the other way in. It parses arguments, reads a
file or standard input, and calls `compileAsync`.

## Tokenizing and parsing

[`src/language/tokenizer.ts`](../src/language/tokenizer.ts) turns source text
into tokens that retain their offsets, so every later diagnostic can name a line
and column.

[`src/language/parser.ts`](../src/language/parser.ts) has two halves.
`parseSyntax` builds a `SourceDocument` — structure without meaning.
`lowerSyntax` then resolves that against the library manifests and produces a
`DiagramDocument`. `parseSource` runs both.

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

[`src/language/expander.ts`](../src/language/expander.ts) inlines templates and
gives the expanded declarations hygienic identifiers, so two uses of one
template cannot collide.

[`src/language/semantic.ts`](../src/language/semantic.ts) lowers the expanded
AST into a `SemanticDocument`: it lowers decision branches, indexes every
object and reference, and runs `validateSemanticDocument`.

That validator is a frozen array of rule families applied to each statement.
**Array order is part of the contract** — it determines the order diagnostics
appear in, which `test/semantic-diagnostics.test.ts` pins.

## Measuring and placing

[`src/compile/scene.ts`](../src/compile/scene.ts) builds the `SceneGraph` that
the rest of compilation mutates, and `layoutWithAdapter` dispatches to a layout
adapter after checking the document's requirements against that adapter's
capabilities.

[`src/compile/measurement.ts`](../src/compile/measurement.ts) sizes content
before it can be placed, using the font metrics in
[`src/text/`](../src/text/).

[`src/layout/`](../src/layout/) holds the adapters: `builtin.ts` for rows,
columns, grids, and trees, and `layered.ts` for flat graphs via ELK. The ELK
integration runs in a worker; see [`src/layout/elk/`](../src/layout/elk/).

[`src/compile/geometry-pass.ts`](../src/compile/geometry-pass.ts) then applies
the precision-geometry statements — alignment, distribution, offset,
`match-size`, rotation, and snapping. These run **after** automatic layout, so
they override it rather than participate in it.

[`src/routing/`](../src/routing/) routes connectors around the placed nodes and
positions their labels.

## Emitting

[`src/compile/render.ts`](../src/compile/render.ts) drives the whole back half
and produces a `Drawing`. It is the widest module in the codebase, importing
around two dozen others, because it is where measurement, layout, geometry,
routing, and emission meet.

[`src/excalidraw/`](../src/excalidraw/) owns the target format: the `Drawing`
document, element and component constructors, and the adapter that turns scene
visuals into native elements.

[`src/nodes/`](../src/nodes/) handles content that needs more than a shape:
`rich-nodes.ts` dispatches by node kind to the formula, table, and architecture
families, with the math subsystem under `nodes/math/`.

## Module layers

![XDraw module layers](images/module-layers.png)

Dependencies point downward. The four most imported modules are in
[`src/contracts/`](../src/contracts/) and hold types only, so TypeScript erases
those imports and they cost nothing at run time. That is what keeps the module
graph free of runtime cycles.

Keep shared types in `contracts/`. Moving them into the modules that use them
converts type-only edges into runtime edges and makes cycles easy to introduce.

Modules named in the package `exports` map — `index.ts`, `browser.ts`,
`xdraw.ts`, `excalidraw-api.ts` — stay at the `src/` root, because moving one
changes the published package layout.

## Extension points

![XDraw extension seams](images/extension-seams.png)

Four seams, each with two or more existing implementations:

| seam | declared in | implementations |
| --- | --- | --- |
| layout adapter | [`compile/scene.ts`](../src/compile/scene.ts) | `BUILTIN_LAYOUT`, `LAYERED_LAYOUT` |
| rich node family | [`nodes/rich-nodes.ts`](../src/nodes/rich-nodes.ts) | formula, table, architecture |
| worker host | [`platform/worker-host.ts`](../src/platform/worker-host.ts) | node, browser |
| file system | [`io/filesystem.ts`](../src/io/filesystem.ts) | rooted, in-memory |

Prefer adding an implementation behind an existing seam. Introduce a new one
only when a second concrete use exists — one implementation is a hypothetical
seam, two is a real one.

## Constraints worth knowing

These look incidental and are not.

- **Validation-rule order is observable.** It sets the order of returned
  diagnostics.
- **Browser worker construction must stay a literal.** Bundlers only detect a
  worker when they can see `new Worker(new URL("./worker-browser.js",
  import.meta.url))` written out. Computing that URL produces a page that hangs
  with no error.
- **`contracts/` holds types only.** See the module-layer section above.
- **Two validators run, and both are load-bearing.** `language/validator.ts`
  checks documents against manifests; `validateSemanticDocument` checks semantic
  constraints. The overlap is deliberate: `compile` accepts a `SemanticDocument`,
  so a caller can bypass the parser entirely.
- **Code has its own size budget**, larger than the one for display text. See
  [`src/text/policy.ts`](../src/text/policy.ts).

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
  inspect the scene diff before accepting a new fingerprint — the failure means
  output changed, not that the test is stale.
