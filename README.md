# Gingerbread

Gingerbread is a tool for converting vector artwork to KiCAD PCB files that lives in your browser.

See https://gingerbread.wntr.dev for more information.

## Building & Running

1. make sure you have python3 and zig (0.16.0) installed
2. install the Python requirements with `make deps` (or `python3 -m pip install -r requirements.txt`)
3. run `make serve` in the root directory and visit `http://localhost:8000/` to view the site

`make serve` builds the native code in `native/` into a wasm module, assembles
the site into `build/`, and serves it. Other targets:

| Target | What it does |
| --- | --- |
| `make` | Build the wasm module and the site into `build/` |
| `make deps` | Install the Python requirements |
| `make serve` | Build everything, then serve `build/` over HTTP |
| `make watch` | Build, serve, and rebuild on changes (needs `livereload`) |
| `make native` | Build the wasm module only |
| `make web` | Assemble `build/` from `web/` and the built wasm module |
| `make clean` | Remove `build/` and the Zig output and cache directories |

`make watch` additionally needs `livereload` (`python3 -m pip install
livereload`). It's kept out of `requirements.txt` on purpose — `build.py` starts
a watching server rather than exiting when `livereload` is importable, which
would hang a non-interactive build.

`OPTIMIZE` selects the Zig optimize mode and defaults to `ReleaseFast`, which is
what gets deployed. Use `make OPTIMIZE=Debug` for faster rebuilds while working
on the native code. `PORT` sets the port for `make serve` (default 8000). Run
`make help` for the full list.

Building by hand without make also works: `zig build -Doptimize=ReleaseFast` in
`native/`, then `python3 build.py` in the root directory. Note that `build.py`
also starts a watching livereload server if `livereload` is installed, so it
won't exit on its own in that case.

## License and contributing

Gingerbread is open source! Please take a chance to read the [LICENSE](LICENSE.md) file.

We welcome contributions! Please read our [Code of Conduct](CODE_OF_CONDUCT.md).
