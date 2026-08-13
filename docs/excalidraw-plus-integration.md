# Excalidraw+ integration

XDraw can discover, create, update, and retrieve hosted Excalidraw+ scenes. The
browser remains the place for manual editing and collaboration.

## Discover scenes

List every scene visible to the API key:

```bash
xdraw list
```

Optionally select one collection by its name or ID:

```bash
xdraw list Architecture
```

Each result includes a canonical address and its stable scene ID. Names make
commands readable; IDs remain available when names are duplicated.

```text
ADDRESS                                                     SCENE ID
excalidraw::default::Architecture::System overview          scene-123
```

The workspace segment is `default` because the API key selects the workspace.

## Retrieve scenes

`pull` accepts an address from `list` or a raw scene ID. Without `-o`, it writes
an editable `.excalidraw` file in the current directory. The output extension
selects other formats:

```bash
xdraw pull "excalidraw::default::Architecture::System overview"
xdraw pull scene-123 -o system-overview.excalidraw
xdraw pull scene-123 -o system-overview.png
xdraw pull scene-123 -o system-overview.svg
```

PNG and SVG output is rendered locally. Preview controls apply only to those
formats:

```bash
xdraw pull scene-123 -o component.png --frame component --max-width 1200 --padding 32
xdraw pull scene-123 -o logo.png --background transparent
```

## Scene documents

`xdraw apply` accepts a scene document. Its resource identifies the collection
and scene, while its operation is explicitly `replace` or `patch`:

```xdraw
scene excalidraw::default::architecture::system_overview {
  replace {
    diagram "System overview" {
      source: rectangle "Source"
      target: rectangle "Target"
      source -> target
    }
  }
}
```

Collection and scene segments can be IDs or unambiguous normalized names.

`replace` creates the scene when needed and makes the XDraw source
authoritative for its complete contents.

`patch` changes elements by their XDraw IDs. Unrelated elements and manual
canvas edits are retained.

After `apply`, XDraw prints both the resource address and the scene ID.

## Authentication

Set the personal API key before using remote commands:

```bash
export EXCALIDRAW_API_KEY="your-api-key"
```

The REST base URL defaults to `https://api.excalidraw.com/api/v1`. Override it
with `EXCALIDRAW_API_URL` or `--api-url` when using another endpoint.
