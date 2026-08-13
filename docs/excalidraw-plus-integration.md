# Excalidraw+ integration

XDraw can create, replace, patch, download, and preview hosted Excalidraw+
scenes. The browser remains the place for manual editing and collaboration.

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

The workspace segment is `default` because the API key selects the workspace.
Collection and scene segments can be IDs or unambiguous names.

`replace` creates the scene when needed and makes the XDraw source
authoritative for its complete contents.

`patch` changes elements by their XDraw IDs. Unrelated elements and manual
canvas edits are retained.

`pull` downloads the editable scene JSON. `inspect` downloads the same content
and renders a PNG or SVG locally, so it does not require a remote screenshot
service.

## Authentication

Set the personal API key before using remote commands:

```bash
export EXCALIDRAW_API_KEY="your-api-key"
```

The REST base URL defaults to `https://api.excalidraw.com/api/v1`. Override it
with `EXCALIDRAW_API_URL` or `--api-url` when using another endpoint.
