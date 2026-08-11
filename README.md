# XDraw

XDraw turns concise text into editable Excalidraw diagrams.

```xdraw
diagram "Order flow" {
  customer: person "Customer"
  api: system "Orders API"
  store: database "Order data"

  customer -> api "places order"
  api -> store "saves"
}
```

## Install

XDraw requires Node.js 22 or newer.

```bash
git clone https://github.com/fractalops/xdraw.git
cd xdraw
npm install
npm link
xdraw --version
```

## Build a Diagram

Save the example above as `order-flow.xdraw`, then run:

```bash
xdraw check order-flow.xdraw
xdraw build order-flow.xdraw
```

`check` validates the source without writing output. `build` creates
`order-flow.excalidraw` beside the source file. Open it in
[Excalidraw](https://excalidraw.com) to continue editing.

Choose another output path with `-o` or `--output`:

```bash
xdraw build order-flow.xdraw -o ~/Desktop/order-flow.excalidraw
```

## Input and Output

XDraw accepts files, standard input, and inline expressions:

```bash
cat order-flow.xdraw | xdraw build -o order-flow.excalidraw
xdraw build < order-flow.xdraw > order-flow.excalidraw
xdraw build -e 'a: card "Source"; b: card "Target"; a -> b' -o quick.excalidraw
```

Use `-o -` to write generated Excalidraw JSON to standard output.

## Language Tour

Group related nodes in a frame:

```xdraw
diagram "Platform" {
  frame platform "Platform" {
    web: system "Web app"
    api: system "API"
    web -> api
  }
}
```

Model a decision:

```xdraw
diagram "Release decision" {
  request: card "Request"
  approved: decision "Approved?" {
    when "yes" -> release
    when "no" -> revise
  }
  release: card "Release" success
  revise: card "Revise" warning
  request -> approved
}
```

Reuse a component:

```xdraw
diagram "Services" {
  component service(name) {
    api: system "{name} API"
    data: database "{name} data"
    api -> data
  }

  use service orders [name="Orders"]
  use service billing [name="Billing"]
}
```

See the [language reference](docs/language-reference.md) for the complete
syntax. The files in [`examples/`](examples/) are complete and buildable.

## Excalidraw+

XDraw can replace or selectively update hosted Excalidraw+ scenes through the
Excalidraw+ REST API. Set a personal API key with scene, collection, and
content read/write permissions:

```bash
export EXCALIDRAW_API_KEY="your-api-key"
```

Create `architecture.scene.xdraw`:

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

Apply it:

```bash
xdraw apply architecture.scene.xdraw
```

After replacement, a patch can update known DSL IDs while preserving unrelated
elements and manual canvas edits:

```xdraw
scene excalidraw::default::architecture::system_overview {
  patch {
    update api {
      tone warning
      title "API v2"
    }
    add {
      note review "Requires review" at (80, 80)
    }
  }
}
```

Download or preview a hosted scene using the scene ID returned by `apply`:

```bash
xdraw pull <scene-id> -o architecture.excalidraw
xdraw inspect <scene-id> -o architecture.png
xdraw inspect <scene-id> -o architecture.svg
```

The Excalidraw+ REST API is public beta and may change.

## Commands

```text
xdraw build [<file>|-] [-o <output>]
xdraw check [<file>|-]
xdraw apply [<file>|-]
xdraw pull <scene-id> [-o <output>]
xdraw inspect <scene-id> [-o <png|svg>]
xdraw --help
xdraw --version
```

`build`, `check`, and `apply` also accept `-e <source>`. Errors go to standard
error and return a non-zero exit code.

## Development

```bash
npm test
npm run test:browser

wrkflw validate .github/workflows/ci.yml
wrkflw run --runtime emulation --job verify .github/workflows/ci.yml
```

XDraw is available under the [MIT License](LICENSE).
