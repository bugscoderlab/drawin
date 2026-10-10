# Laddertech Drawing — Wiki

User + operator documentation for the PDF → SVG drawing pipeline.

> The engineering plan, decisions and measurements live in [PLAN.md](../PLAN.md) (repo root). This wiki is the practical "what is it / how do I use it".

## Commands

| Command | What it does |
|---|---|
| [`ladder convert`](Commands.md#ladder-convert) | PDF → faithful SVG (Inkscape → pdftocairo fallback) |
| [`ladder extract`](Extraction.md) | PDF → structured params (rules + one optional vision pass) |
| `ladder generate` | params.json → drawing (matched template, real art where possible) |
| `ladder verify` | extract → generate → dimensions cross-check |
| `ladder batch` | Folder of PDFs → per-PDF artefacts + summary report |
| `ladder render` | Re-render a template (L1 real art / L3 code model) with new params |
| `ladder scaffold` | Author a new template from a PDF |
| `ladder serve` | Upload PDF → scaffold → live editor (http://localhost:8123) |
| `ladder proof` | Before/after render check for a template (`--set param=value` overrides the sample edit) |
| `ladder editor` | Build the self-contained editor HTML for a template |
| [`npm test`](Commands.md#npm-test) | 137 tests: snapshots, registry, render, geometry/part bindings, LLM part proposals (fake-call), re-scaffold (auto-skips without tools) |

## Concepts

- [Layers 1–3: what the system outputs for any PDF](Layers.md)
- [Templates: bind, don't redraw](Templates.md)
- [Conversion & the fallback chain](Conversion.md)

## MCP + in-browser extraction

**MCP server (headless):**
```bash
node bin/mcp.mjs    # stdio MCP — configure in your MCP client
```
Tool: `import_ladder_pdf { pdfPath, llm? }` → `{ module, params, core, confidence, warnings, unmappedText }` (same output as `ladder extract`).

**In the generator HTML** (model-context tools): `configure_ladder_drawing` (set fields directly) and `import_ladder_params` (paste an extract JSON or a Download-params payload — applies it to the form/template and redraws).

**Browser pdf.js path (`file://` spike):** `spike/pdfjs.html` — pick a PDF, pdf.js reads the text layer in-page (main-thread, no server), items are clustered into the same layout string the CLI uses and run through the **same** stitch/rules pipeline (shipped in `ladder-core.js`). Measured on the corpus: equivalent field quality to poppler. Caveat: PDFs with subset fonts pdf.js can't decode yield fewer items — those go through `ladder serve`/CLI (poppler).

## Deploy

Push to `main` → GitHub Actions syntax-checks + tests, then SSHes to the VPS and `docker compose up -d --build`. See [DEPLOY.md](../DEPLOY.md). Live: http://187.53.132.86:8123

## Changelog (wiki pages follow commits)

| Commit | Page |
|---|---|
| `cdb72ac` 1C.7 L2 geometry bindings | [Layers](Layers.md) |
| `d586875` 009 repair verified + Inkscape font gotcha | [Conversion](Conversion.md) |
| `ae71acc` 2.5/2.6 MCP + pdf.js extractor | [Home](Home.md) |
| `70262de` 2.4 Download params + 009 gs-repair hop | [Commands](Commands.md), [Conversion](Conversion.md) |
| `e8b1409` 3.1–3.3 `ladder batch` | [Commands](Commands.md) |
| `7704f5f` 2.1c/d generate + verify | [Extraction](Extraction.md) |
| `8b90102` 1B.7 scoreboard core + `ladder eval` | [Extraction](Extraction.md) |
| `b89ac93` 1.1–1.6 extract pipeline + `ladder extract` | [Extraction](Extraction.md) |
| `e82c73c` 2.2 convert module + `ladder convert` | [Conversion](Conversion.md) |
