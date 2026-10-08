# Vision dimension recovery — design (agreed 2026-10-08)

Status: **implemented** (`src/eval/vision.mjs` + the zero-dims trigger in `src/eval/scaffold.mjs`; tests in `test/vision.test.js`).

## Problem

Some source PDFs (known case: `LSB-2609-007-FHL-R00.pdf`) have dimension annotations as **vector outlines** — `pdftotext` finds only the title block, so scaffold proposes no dimension params and the drawing can never become fully editable. `wiki/Conversion.md` documents the gap; eval's truth table lists these fields as text-layer gaps that only vision fills.

## Decision: outline→text synthesis, not geometry-only

Geometry-only binding (stretch the line, leave the outlined number) would make "edit a dimension" change everything except the visible value — a broken half-feature for exactly the PDFs this targets. Instead, scaffold **replaces the located outline glyph cluster with a real `<text>` node** (position and size from the cluster's bbox, Arial), after which text-binding and `proposeGeometry` run **completely unchanged**.

## Pipeline

1. **Trigger** — only when the text layer yields **zero** numeric dimension params (v1; partial-coverage detection is explicitly out of scope).
2. **Vision call** — `pagePng` + `callLLM` (both existing, importable from scaffold; the formulas-proposal pass already establishes the pattern, incl. injectable fake for tests). Prompt extended to return, per dimension: `{value, x_pct, y_pct}` — normalized coordinates on the page image.
3. **Coordinate conversion** — percentages → SVG user units via the page size from `parseQueryAll`/SVG dims. (Vision sees PNG pixels at 150–300 dpi; rows are in user units — normalize before matching.)
4. **Locate cluster** — find the outline glyph cluster nearest the converted position (tiny adjacent paths, per the outline rows from `--query-all`).
5. **Synthesize** — delete the cluster paths, inject `<text>` with the value; mark the param `unverified: true`.
6. **Existing machinery** — text binding (group mode) and `proposeGeometry` run as today; no special-casing downstream.

## Hallucination policy

- Gate: `proposeGeometry`'s self-calibration already rejects bindings whose px/mm lands outside `[0.005, 2]` — a wrong vision value almost always fails it.
- Rejections are **reported** in scaffold output (`vision: proposed N dims, M rejected by scale check`), never dropped silently.
- Rules cross-check: if rules extracted a text value that conflicts with a vision value for the same position, prefer rules and flag.

## Cost & caching

- One vision call per zero-dim scaffold (~$0.01–0.05); results cached in `vision.json` beside `template.json`, keyed by source-PDF content hash (safe: source drawings don't change).

## Editor surface

`unverified: true` flows verbatim through template.json params into the editor (buildEditor JSON-embeds the template); the param loop gains a badge reusing the existing `.badge` CSS (~4 lines: 1 in scaffold's params mapping, 3 in `editor.template.html`).

## Companion small fixes (same round, agreed)

1. **serve pinning** — scaffold target resolved to the repo root from `src/serve.mjs`'s location, not CWD.
2. **convert honesty** — every hop's outcome always printed on stderr (no flag).
3. **/bind hardening** — ids validated against the template's base SVG (400 on miss); upload token required for `/bind`; server binds `127.0.0.1` unless `HOST` is set.
4. **Preserve-by-default re-scaffold** — keep formulas/labels/constants (current `prevById` carry-over) **plus** hand-made `/bind` id-bindings whose ids still exist in the SVG; outlines and geometry always recomputed; `--force` for the destructive wipe. (Fact-finding gap: today even the accepted carry-over loses hand `/bind` bindings — they are rebuilt fresh.)
5. **Proof printer** — already fixed 2026-10-08 (geometry report rows).
