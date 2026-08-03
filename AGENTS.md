# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gingerbread converts vector artwork (SVG, typically from Inkscape or Affinity Designer) into KiCad PCB
files. It runs entirely in the browser: the geometry work is Zig + C/C++ compiled to WebAssembly, the
UI is vanilla JS with Alpine.js and Bulma, and a small Python script assembles the static site.

## Commands

```
make            # build the wasm module and the site into build/
make serve      # build, then serve build/ on :8000 (PORT= to change)
make watch      # build, serve, and rebuild on changes (needs livereload)
make deps       # pip install -r requirements.txt
make native     # wasm only
make clean      # remove build/, native/zig-out, native/.zig-cache
make help       # targets and variables
```

`OPTIMIZE` defaults to `ReleaseFast` (what CI deploys); use `make OPTIMIZE=Debug` when working on the
Zig side. Zig **0.16.0** is required — the 0.16 build API and `std.Io.Writer` are both used, so older
compilers fail outright.

Lint/format with `npx @biomejs/biome@1.9.4 check .` (config in `biome.json`). Note it currently also
scans generated output in `build/` because `vcs.useIgnoreFile` is `false`, and the repo does not pass
cleanly today — check that a finding is yours before fixing it.

### Tests

There is **no working test suite right now.** `native/src/tests.zig` plus `test` blocks across
`potrace.zig`, `clipper.zig`, `geometry.zig`, `bezier.zig`, `fauxuuid.zig`, and `gingerbread.zig` all
exist, and fixtures live in `native/resources/`, but the wiring is commented out at the bottom of
`native/build.zig`. Re-enabling it for a host target hits two blockers:

- potrace fails with `uint64_t` undeclared: `lib/potrace-config/config.h` only defines `VERSION`, and
  `decompose.c` guards its `<inttypes.h>` include behind `HAVE_INTTYPES_H`.
- Clipper2's `-Dthrow=abort` flag (needed for the exception-free wasm build) collides with glibc's
  `math.h`, which declares `throw ()`.

Keeping the `wasm32-wasi` target and running under wasmtime sidesteps both. The web code has no
automated tests at all; verify UI changes by building and driving the real page in a browser.

## Architecture

### The pipeline

`web/scripts/main.js` holds `Design` (the loaded document) and `Layer`. On load, `make_layers()` builds
one standalone SVG document *per layer* by cloning the root `<svg>` and transplanting matched elements
into it. Layers are matched by `id` **or** `inkscape:label` — see `Design.layer_defs`, which also
carries each layer's KiCad layer number.

From there each layer takes one of three paths, dispatched by `layer.type` in `Design.export()`:

- **raster** (`F.Cu`, `B.Cu`, `F.SilkS`, `B.SilkS`, `F.Mask`, `B.Mask`) — the layer SVG is rendered to
  an `ImageBitmap`, handed to wasm, traced by potrace, and the resulting polygons are fractured by
  Clipper2 into KiCad `fp_poly`s.
- **vector** (`Edge.Cuts`) — path data is flattened to points in JS (`yak.SVGElement_to_paths`) and
  streamed to wasm as `gr_poly` points.
- **drill** — `<circle>` elements become `np_thru_hole` pads.

### Zig ↔ JS boundary

The wasm module is a **WASI reactor** with a stateful, streaming API (`native/src/gingerbread.zig`):
`conversion_start()`, then any number of `conversion_add_raster_layer` / `conversion_start_poly` +
`conversion_add_poly_point` + `conversion_end_poly` / `conversion_add_drill`, then
`conversion_finish()`. Output accumulates into a module-global `std.Io.Writer.Allocating` and is
returned as text, so there is no intermediate geometry representation crossing the boundary.

Strings come back via `wasm.return_string`: a pointer to a two-`u32` `[ptr, len]` pair, which
`zigwasm.js` reads and frees. `z_allocate`/`z_free` manage the shared heap.

**Do not call `_initialize`.** The module exports it, but it panics with an integer overflow and
nothing in the app calls it.

`web/scripts/wasi.js` is a hand-rolled WASI shim. wasi-libc imports far more of preview1 than this code
uses, and the exact set shifts between Zig releases while a single missing import fails instantiation
outright — so the export table is wrapped in a `Proxy` that returns an `ENOSYS` stub for anything not
explicitly implemented. Add real implementations there; don't remove the fallback.

Layer numbers are magic integers duplicated between `Design.layer_defs[].number` in `main.js` and the
`switch` statements in `gingerbread.zig`. Change both together.

### Coordinates

The SVG `viewBox` defines the working unit ("pts" in the code). `Design.dpi` (default 2540) converts to
millimetres via `dpmm = 25.4 / dpi`, and every wasm call takes a scale factor: vector/drill calls take
`dpmm` directly, raster calls take `trace_scale_factor`, which also accounts for rasters being rendered
at half the viewBox width.

### SVG transforms

`getPathData()` returns coordinates in an element's *own* user space and ignores transforms, while the
preview renders the SVG and honours them — so any transform-aware work has to be done explicitly, or
the preview and the export silently disagree. Inkscape records a resize as a `transform` rather than
rewriting path data, so this is the common case, not an edge case. Two places handle it, both in
`yak.js`:

- `SVGElement_to_paths` / `SVGElement_to_circles` thread an accumulated matrix down the tree and apply
  it to extracted geometry. `getCTM()` is unusable here because layer documents are never attached to
  the page; `transform.baseVal` is read instead.
- `transplantElement` collapses the transforms of the ancestors an element is lifted out of into a
  wrapping `<g>`. Because that wrapper lives in the layer document, it fixes the rendering path and the
  extraction path at once.

### Build

`build.py` renders `web/*.html` through Jinja2 (`web/templates/layout.html` is the shared shell), copies
`web/scripts`, `web/styles`, `web/images`, and drops `native/zig-out/bin/gingerbread.wasm` into
`build/native/`. Running `python3 build.py` directly also starts a livereload watcher **if `livereload`
is importable**, so it may not exit — that's why `make web` calls `build.build()` instead, and why
`livereload` is deliberately left out of `requirements.txt`.

`.github/workflows/deploy.yml` builds with Zig 0.16 and publishes `build/` to GitHub Pages on pushes to
`main`. It only runs on push, so there is no pre-merge check.

## Vendored dependencies

`native/lib/` holds potrace 1.16, Clipper2, and stb_image, built from source by `native/build.zig`.
Clipper2 is compiled with `-fno-exceptions -Dthrow=abort` for wasm. `web/scripts/` vendors Alpine.js,
Bulma, and a `getPathData()` polyfill (that API is not native in any browser, so the polyfill is always
what runs).
