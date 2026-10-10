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
node bin/ladder.mjs scaffold "file.pdf" [--force]
```

Convert → hide outline duplicates → auto-propose bindings (title block + dimensions, geometry annotations, and part bindings for the geometry each dimension measures) → write `templates/<id>/` → build the editor HTML in `preview/`.

With an LLM key in `.env` (see `.env.example`), two optional passes augment
the scaffold: zero-dims **vision recovery** (outline-only annotations) and
**LLM part proposals** — for each dimension the rules skipped candidates on,
the model picks which elements the dimension measures (`spans` vs
`attached`) from the same candidate pool; the engine derives ops and
self-calibrates, rejects anything outside the pool, and the report shows the
rule/llm split per dimension (`docs/plans/llm-part-bindings.md`). Without a
key both passes are quiet no-ops — the server never needs one.

Re-scaffold is **preserve-by-default**: an existing `templates/<id>/` is merged —
per-param formulas, labels, named constant params, and hand-made id-bindings
(`POST /bind`) whose ids still exist in the base art are kept; hand-made part
bindings survive when their ids still exist and the param's value is unchanged
(their calibration is re-derived from the fresh art); outline hiding,
value bindings, and geometry proposals are recomputed from the current art.
`--force` restores the from-scratch wipe.

## ladder serve

The upload page shows an **LLM** pill in the header — green *LLM connected*
when the server resolves a key (`.env` interpolated into the container by
compose, same mechanism as `UPLOAD_TOKEN`; the image never carries it), grey *rules only* when keyless. After an
upload, the result panel reports the part-binding provenance: how many dims
the model was consulted on, and how many bindings it contributed vs. how many
ids the engine rejected.

```bash
node bin/ladder.mjs serve [port]    # default 8123
```

Upload page → scaffold → live editor bridge. Conversion is native, which is why this needs the server (or the Docker container).
Set `DRAWIN_ROOT=/path/to/root` to pin the server's templates/preview dirs somewhere other than its own install location (test seam for the HTTP tests).

## ladder proof / ladder editor

```bash
node bin/ladder.mjs proof templates/<id> [--set param=value ...]   # before/after render check
node bin/ladder.mjs editor templates/<id>    # (re)build preview/<id>-editor.html
```

`proof` renders the template's original values beside its `sample` values (the
binding report goes to stdout, images to `preview/<id>/`); repeatable
`--set param=value` overrides sample params for the AFTER image — e.g. the 004
part-binding proof (fresh scaffold of `LSB-2607-004-FHL-R00.pdf`, artifacts in
`preview/lsb-2607-004-fhl-r00/`) uses `--set dim1=1000` so the comparison shows
the widened cap with the bars meeting the moved rail.

## Download params (HTML bridge)

The generator HTML has a **Download params** button (next to Download SVG). It exports the current form as JSON:
- module modes → `{ "module": "cage", "values": { ...form fields } }` — feed to `node bin/ladder.mjs generate params.json -o out.svg`
- Template mode → `{ "template": "trolley-slt", "values": { ... } }` — feed to `node bin/ladder.mjs render trolley-slt params.json -o out.svg`

## ladder batch

```bash
node bin/ladder.mjs batch ./pdfs --out ./out [--no-llm]
```

A folder of PDFs → a complete, self-describing output set. **Per PDF**: `name.params.json` (full extract incl. confidence + warnings), `name.converted.svg` (Channel A — always attempted, independently of extraction), `name.generated.svg`, `name.report.md`. Plus a folder **`report.md`** summary table and a failures section. One bad PDF is reported and the batch continues (exit code 1 if anything failed). New vendors need no code — add a profile entry in `src/extract/profiles.mjs`.

## npm test

```bash
npm test                    # build (bundle+manifest) then node --test
UPDATE_SNAPSHOTS=1 npm test # regenerate render fixtures after an intentional change
```

137 tests across snapshots (per-module fixtures + bundle↔ESM parity), registry matching, `ladder render`, geometry/part bindings, LLM part proposals (fake-call), re-scaffold preservation, and conversion (the real-conversion cases skip when Inkscape/poppler are absent).
