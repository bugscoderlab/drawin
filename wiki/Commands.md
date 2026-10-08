# Commands

All from the repo root. Node 22 required; Inkscape + poppler for anything touching PDFs.

## ladder convert

```bash
node bin/ladder.mjs convert <file.pdf> -o out.svg [--converter auto|inkscape|pdftocairo]
```

Faithful PDF → SVG. `auto` (default) tries Inkscape first and falls back to pdftocairo on crash/timeout. See [Conversion](Conversion.md).

## ladder render

```bash
node bin/ladder.mjs render <templateId> [params.json] [-o out.svg]
```

Re-render a registry template:
- **L1** templates (`trolley-slt`, `cage-fhl`, …) — the real converted art with bound values replaced. Missing keys fall back to the template's own defaults. A binding report (`6/6 bindings ok`, or the misses + reasons) goes to stderr.
- **L3** templates (`cat-l3`, `cage-l3`, `trolley-l3`) — the parametric code models from `src/core`.

```bash
echo '{ "customer": "ACME SDN BHD", "footprint": "3100" }' > p.json
node bin/ladder.mjs render trolley-slt p.json -o out.svg
```

## ladder scaffold

```bash
node bin/ladder.mjs scaffold "file.pdf"
```

Convert → hide outline duplicates → auto-propose bindings (title block + dimensions) → write `templates/<id>/` → build the editor HTML in `preview/`.

## ladder serve

```bash
node bin/ladder.mjs serve [port]    # default 8123
```

Upload page → scaffold → live editor bridge. Conversion is native, which is why this needs the server (or the Docker container).

## ladder proof / ladder editor

```bash
node bin/ladder.mjs proof templates/<id>     # before/after render check
node bin/ladder.mjs editor templates/<id>    # (re)build preview/<id>-editor.html
```

## npm test

```bash
npm test                    # build (bundle+manifest) then node --test
UPDATE_SNAPSHOTS=1 npm test # regenerate render fixtures after an intentional change
```

23 tests across snapshots (per-module fixtures + bundle↔ESM parity), registry matching, `ladder render`, and conversion (the real-conversion cases skip when Inkscape/poppler are absent).
