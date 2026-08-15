# Architecture

This page is for contributors who need to find their way around the compiler.
The [language specification](spec.md) defines the language; this page shows
where the compiler implements it.

The diagrams come from runnable examples. The test suite compiles them, and
`npm run docs:images` regenerates the images.

## How a document becomes a scene

![The XDraw compilation pipeline](images/compilation-pipeline.png)

```bash
xdraw build examples/compilation-pipeline.xdraw
```

The boxes are intermediate artifacts. The arrows are the transformations
between them.

`SemanticDocument` separates source processing from layout. Code before it
works with tokens, spans, constructors, and templates. Code after it works with
measured text, positioned bounds, and routed connectors. Start on the side that
owns the behaviour you are changing.

There are two compilation entry points. `compile` is synchronous.
`compileAsync` prepares syntax highlighting, formula rasterisation, and ELK
placement before calling the same renderer. Rendering itself remains pure.

## Why the module graph has no cycles

![XDraw module layers](images/module-layers.png)

```bash
xdraw build examples/module-layers.xdraw
```

Dependencies point down through the module layers. The four most imported
modules live in `contracts/` and contain types only, so TypeScript removes those
imports from the emitted JavaScript. The current 69-module graph has no runtime
cycles.

Keep shared types in `contracts/`. Moving them into implementation modules
would turn type-only dependencies into runtime dependencies and make cycles
much easier to introduce.

## Where to extend it

![XDraw extension seams](images/extension-seams.png)

```bash
xdraw build examples/extension-seams.xdraw
```

The diagram shows the four supported extension points. Each already has at
least two implementations. Add another implementation through one of these
interfaces where possible. Introduce a new abstraction only when there is more
than one concrete use for it.

## Reference map

![XDraw architecture reference](images/architecture-cheatsheet.png)

```bash
xdraw build examples/architecture-cheatsheet.xdraw
```

The first panel maps the specification's [nine processing steps](spec.md) to
their implementing modules. The earlier pipeline diagram instead shows the
artifacts passed between those steps.

**Where things live.** A directory represents a subsystem. Other modules stay
flat. Modules listed in the package `exports` map remain at the `src/` root
because moving them changes the published package layout.

**Where behaviour varies.** These are the existing extension points and their
implementations.

**Invariants.** These constraints are intentional. Check them before changing
module boundaries, semantic expansion, layout, or rendering.
