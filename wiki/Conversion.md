# Conversion & the fallback chain

`src/convert/convert.mjs` — Channel A of the pipeline: **every PDF must yield a faithful SVG**, whatever else happens downstream.

## Why a chain?

Measured on the corpus (PLAN §2a):

| | Inkscape | pdftocairo |
|---|---|---|
| Keeps real `<text>` | ✅ | ❌ (outlines everything) |
| File size | ~½ of pdftocairo | larger |
| Robustness | ❌ **segfaults on some PDFs** (exit 139, reproducible on `LSB-2609-007`) | ✅ all 3 corpus PDFs |

Neither is good enough alone, so `auto` (the default) tries them in order:

1. **Inkscape** — with a 120 s per-attempt timeout (it hung >300 s on one rasterize during eval).
2. **Ghostscript repair + Inkscape** (the `009` fix) — when Inkscape crashes, `gs -sDEVICE=pdfwrite` rewrites the PDF; the rewritten file very often imports cleanly while keeping the text layer. Chain order is unit-tested; the actual segfault-repair is verified on the owner's Mac (this environment has no Inkscape).
3. **pdftocairo** — on any remaining failure, or when the repair hop is unavailable (no `gs`).

The backend that actually produced the file is returned (`{ converter }`) so callers can adapt: e.g. scaffold only runs outline-deduplication on the Inkscape path, because pdftocairo output has no text layer to bind anyway.

## Usage

```bash
node bin/ladder.mjs convert "LSB-2607-003-RHC-R00.pdf" -o converted.svg
node bin/ladder.mjs convert "LSB-2609-007-FHL-R00.pdf" -o out.svg --converter pdftocairo   # force
```

Errors name every attempt and its reason, e.g.:
`conversion failed — inkscape (signal SIGSEGV — segfault): … | pdftocairo: not found on PATH`

## Requirements

- Inkscape 1.4+ (`~/.local/bin/inkscape` preferred, else PATH) — better output where it works
- poppler (`pdftocairo`) — the guaranteed floor

Both are in the Docker image; on macOS: `brew install inkscape poppler`.
Tests skip the real-conversion cases when neither is installed.
