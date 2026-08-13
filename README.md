<p align="center">
  <img src="docs/images/xdraw-logo.png" alt="XDraw" width="620">
</p>

<p align="center">
  Describe diagrams in text. Keep editing them in Excalidraw.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#language">Language</a> ·
  <a href="#hosted-scenes">Hosted scenes</a> ·
  <a href="docs/language-reference.md">Reference</a>
</p>

XDraw compiles a small, readable language into editable `.excalidraw` files,
PNG previews, and SVG previews.

## Quick Start

XDraw requires Node.js 22.18 or newer.

```bash
git clone https://github.com/fractalops/xdraw.git
cd xdraw
npm install
npm link
```

Create `order-flow.xdraw`:

```xdraw
use "xdraw/architecture" as arch

diagram "Order flow" {
  customer: arch.person "Customer"
  api: arch.system "Orders API"
  store: arch.database "Order data"

  customer -> api "places order"
  api -> store "saves"
}
```

Build it:

```bash
xdraw build order-flow.xdraw
```

This creates `order-flow.excalidraw` beside the source. Open it in
[Excalidraw](https://excalidraw.com) to continue editing.

Use `-o` to create a preview or choose another destination:

```bash
xdraw build order-flow.xdraw -o output/order-flow.png
cat order-flow.xdraw | xdraw build -o output/order-flow.excalidraw
```

## Language

The declaration form, core primitives, and composition rules fit on one
runnable cheatsheet:

![XDraw quick reference](docs/images/readme-cheatsheet.png)

```bash
xdraw build examples/readme-cheatsheet.xdraw
```

Continue with the [full cheatsheet](examples/xdraw-cheatsheet.xdraw), browse
the runnable [`examples/`](examples/), or read the
[language reference](docs/language-reference.md).

## Hosted Scenes

XDraw can replace a complete Excalidraw+ scene or patch elements identified by
stable XDraw IDs while preserving unrelated canvas edits.

```bash
export EXCALIDRAW_API_KEY="your-api-key"
xdraw apply architecture.scene.xdraw
xdraw pull <scene-id> -o output/architecture.excalidraw
```

See the [Excalidraw+ guide](docs/excalidraw-plus-integration.md) for scene
documents, patching, permissions, and API configuration.

## CLI

```text
xdraw build [<file>|-] [-o <output>]
xdraw check [<file>|-]
xdraw apply [<file>|-]
xdraw pull <scene-id> [-o <output>]
xdraw inspect <scene-id> [-o <png|svg>]
```

`build`, `check`, and `apply` accept files, standard input, or inline source
with `-e`. Run `xdraw --help` for all options.

## Acknowledgements

XDraw builds on [Excalidraw](https://github.com/excalidraw/excalidraw) and its
open scene format. Automatic layout is powered by
[ELK](https://github.com/kieler/elkjs), code highlighting by
[Shiki](https://github.com/shikijs/shiki), freehand geometry by
[Perfect Freehand](https://github.com/steveruizok/perfect-freehand), and local
preview rendering by [resvg-js](https://github.com/yisibl/resvg-js). Thanks to
the maintainers and contributors of these projects.

## Development

```bash
npm run build
npm run typecheck
npm test
npm run test:browser
```

XDraw is available under the [MIT License](LICENSE).
