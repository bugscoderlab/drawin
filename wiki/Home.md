# Laddertech Drawing — Wiki

User + operator documentation for the PDF → SVG drawing pipeline.

> The engineering plan, decisions and measurements live in [PLAN.md](../PLAN.md) (repo root). This wiki is the practical "what is it / how do I use it".

## Commands

| Command | What it does |
|---|---|
| [`ladder convert`](Commands.md#ladder-convert) | PDF → faithful SVG (Inkscape → pdftocairo fallback) |
| [`ladder extract`](Extraction.md) | PDF → structured params (rules + one optional vision pass) |
| `ladder render` | Re-render a template (L1 real art / L3 code model) with new params |
| `ladder scaffold` | Author a new template from a PDF |
| `ladder serve` | Upload PDF → scaffold → live editor (http://localhost:8123) |
| `ladder proof` | Before/after render check for a template |
| `ladder editor` | Build the self-contained editor HTML for a template |
| [`npm test`](Commands.md#npm-test) | 23 tests: snapshots, registry, render, convert (auto-skips without tools) |

## Concepts

- [Layers 1–3: what the system outputs for any PDF](Layers.md)
- [Templates: bind, don't redraw](Templates.md)
- [Conversion & the fallback chain](Conversion.md)

## Deploy

Push to `main` → GitHub Actions syntax-checks + tests, then SSHes to the VPS and `docker compose up -d --build`. See [DEPLOY.md](../DEPLOY.md). Live: http://187.53.132.86:8123

## Changelog (wiki pages follow commits)

| Commit | Page |
|---|---|
| `b89ac93` 1.1–1.6 extract pipeline + `ladder extract` | [Extraction](Extraction.md) |
| `e82c73c` 2.2 convert module + `ladder convert` | [Conversion](Conversion.md) |
