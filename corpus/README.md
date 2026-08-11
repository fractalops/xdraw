# XDraw language corpus

This corpus tests the language against eighteen representative diagrams. It is
regression evidence, not a gallery.

- `supported/` contains valid XDraw that must parse and compile deterministically.
- `corpus.json` records the capability exercised or missing in every example.

Run `npm run test:corpus` after changing the parser, compiler, or corpus. Add an
example only when it exercises a distinct semantic or layout capability.

## What the corpus currently says

The language now covers linear and cross-lane flows, recursive trees, nested
system groups, sequence interactions, annotations, bounded precision layout,
named styles, ellipses, controlled text, native frames, flat layered graphs,
advanced connectors, reusable components, and portable local assets.
