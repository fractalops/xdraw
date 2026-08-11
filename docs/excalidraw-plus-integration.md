# Excalidraw+ integration

## Product boundary

XDraw owns its language, validation, deterministic layout, offline
`.excalidraw` generation, and local PNG/SVG rendering. Excalidraw+ owns hosted
scenes, workspace access, browser editing, persistence, and collaboration.

The CLI calls the Excalidraw+ REST API directly and does not host a persistent
canvas.

## Scene documents

`xdraw apply` accepts a scene document. Its resource identifies the collection
and scene, while its operation is explicitly `replace` or `patch`:

```xdraw
scene excalidraw::default::architecture::system_overview {
  replace {
    diagram "System overview" {
      source: card "Source"
      target: card "Target"
      source -> target
    }
  }
}
```

The workspace segment is `default` because the API key selects the workspace.
Collection and scene segments can be IDs or unambiguous names.

`replace` resolves or creates the scene and sends the complete compiled drawing
with `PUT /scenes/{id}/content`. The source is authoritative.

`patch` first reads the current scene, resolves DSL selectors through
`customData.xdrawId`, and sends complete changed elements with incremented
versions through `PATCH /scenes/{id}/content`. Deletions use Excalidraw's
`isDeleted` marker. Unrelated elements and manual canvas edits are retained.

`pull` downloads the editable scene JSON. `inspect` downloads the same content
and renders a PNG or SVG locally, so it does not require a remote screenshot
service.

## Authentication

Set the personal API key before using remote commands:

```bash
export EXCALIDRAW_API_KEY="your-api-key"
```

The REST base URL defaults to `https://api.excalidraw.com/api/v1`. Override it
with `EXCALIDRAW_API_URL` or `--api-url` for testing.

## Architecture

REST request handling and scene merge behavior stay in
`src/excalidraw-api.js`. Local rendering stays in `src/local-renderer.js`.
Compiler and language modules do not depend on either remote schemas or
authentication.
