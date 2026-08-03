ZIG ?= zig
PYTHON ?= python3
OPTIMIZE ?= ReleaseFast
PORT ?= 8000

.PHONY: all
all: web

.PHONY: help
help:
	@echo "Targets:"
	@echo "  all     Build the wasm module and the web pages into build/ (default)"
	@echo "  deps    Install the Python requirements"
	@echo "  native  Build the wasm module only"
	@echo "  web     Assemble build/ from web/ and the built wasm module"
	@echo "  serve   Build everything, then serve build/ over HTTP"
	@echo "  watch   Build, serve, and rebuild on changes (needs livereload)"
	@echo "  clean   Remove build/ and the Zig output and cache directories"
	@echo ""
	@echo "Variables:"
	@echo "  OPTIMIZE  Zig optimize mode: Debug, ReleaseSafe, ReleaseFast, ReleaseSmall (now: $(OPTIMIZE))"
	@echo "  PORT      Port for 'make serve' (now: $(PORT))"
	@echo "  ZIG       Zig executable (now: $(ZIG))"
	@echo "  PYTHON    Python executable (now: $(PYTHON))"

.PHONY: deps
deps:
	$(PYTHON) -m pip install -r requirements.txt

.PHONY: native
native:
	cd native && $(ZIG) build -Doptimize=$(OPTIMIZE)

.PHONY: web
web: native
	$(PYTHON) build.py

.PHONY: serve
serve: all
	@echo "Serving http://localhost:$(PORT)/"
	$(PYTHON) -m http.server $(PORT) --directory build

.PHONY: watch
watch: all
	$(PYTHON) build.py --watch

.PHONY: clean
clean:
	rm -rf build native/zig-out native/.zig-cache
