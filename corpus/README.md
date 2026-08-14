# XDraw language corpus

This corpus is executable regression evidence and a visual map of XDraw itself.
Each diagram explains a language feature, compiler stage, layout mechanism, or
integration boundary while exercising that capability.

- `supported/` contains valid XDraw that must parse and compile deterministically.
- `corpus.json` records the capability exercised or missing in every example.

Run `npm run test:corpus` after changing the parser, compiler, or corpus. Add an
example only when it exercises a distinct semantic or layout capability.

## What the corpus currently says

The diagrams cover the source-to-scene compiler, diagnostics, layout selection,
routing, templates, assets, styles, frames, hosted scenes, local rendering and
package verification. Together they also exercise linear and cross-lane flows,
recursive trees, sequences, annotations, precision placement, highlighted code,
native freehand, portable local assets and deterministic mathematical formulas.
