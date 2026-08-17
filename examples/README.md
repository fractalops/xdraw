# XDraw examples

Every example explains XDraw while exercising the feature it describes. Start
with the language tour, then use the focused examples to inspect individual
compiler and rendering capabilities.

Build any diagram with:

```bash
xdraw build examples/compiler-flow.xdraw
```

## Learning the language

| Example | What it explains |
|---|---|
| `language-tour.xdraw` | The complete source-to-Excalidraw journey |
| `readme-cheatsheet.xdraw` | Declaration anatomy, primitives and composition |
| `xdraw-cheatsheet.xdraw` | The broader language and scene-editing reference |
| `compiler-flow.xdraw` | The smallest useful compiler flow |

## Structure and layout

| Example | What it explains |
|---|---|
| `xdraw-architecture.xdraw` | Architecture notation, composite symbols, boundaries and routing |
| `architecture-cheatsheet.xdraw` | The architecture library's constructors side by side |
| `deployment-environments.xdraw` | One template instantiated once per environment |
| `connections.xdraw` | Connector routes, arrowheads and structural links |
| `frames.xdraw` | Native frame ownership, nesting and locking |
| `styling.xdraw` | Theme, named-style and local-property precedence |

## Computed values

| Example | What it explains |
|---|---|
| `named-values.xdraw` | A number named once and used everywhere it applies |
| `repetition.xdraw` | One declaration expanded by `each` and by `count` |
| `measured-annotations.xdraw` | Positions taken from geometry the compiler has measured |

## Content

| Example | What it explains |
|---|---|
| `text-layout.xdraw` | Text measurement, wrapping and alignment |
| `code-blocks.xdraw` | Editable highlighted source blocks |
| `tables.xdraw` | Measured columns and wrapped cells that stay editable |
| `formulas.xdraw` | TeX rendered to SVG inside an editable scene |
| `primitive-illustration.xdraw` | Composing editable primitives into freeform artwork |
| `xdraw-logo.xdraw` | Building XDraw's visual mark from native elements |

## Plotting curves

| Example | What it explains |
|---|---|
| `parametric-plots.xdraw` | A butterfly, a harmonograph and a decaying wave |
| `curve-gallery.xdraw` | Six classical curves from the same constructor |
| `plot-tolerance.xdraw` | What the stated tolerance buys, at three settings |
| `curve-markers.xdraw` | Markers placed at a distance along a drawn curve |
| `templated-curves.xdraw` | One rose template, six parameterisations |
| `plot-flow.xdraw` | Curves used as ordinary elements in a diagram |
| `fractal-curve.xdraw` | A Weierstrass function at three truncation depths |
| `fractal-series.xdraw` | The fractals a closed vocabulary can and cannot reach |

## The compiler, drawn in its own language

| Example | What it explains |
|---|---|
| `compilation-pipeline.xdraw` | How a document becomes a scene |
| `module-layers.xdraw` | Why the module graph has no cycles |
| `extension-seams.xdraw` | Where to add a constructor, a layout or a backend |

## Hosted scenes

| Example | What it explains |
|---|---|
| `hosted-scene.scene.xdraw` | Replacing a hosted scene through a scene document |
