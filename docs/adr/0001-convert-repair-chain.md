# Convert chain carries two repair rewriters, not one

Status: accepted (2026-10-08)

The `auto` conversion chain is Inkscape → repair → pdftocairo-SVG, where "repair" was originally a single Ghostscript `pdfwrite` rewrite of the PDF before retrying Inkscape. Verified on macOS/Inkscape 1.4.4: Inkscape segfaults on `LSB-2609-007-FHL-R00.pdf` with both importers, and the `gs` rewrite does **not** cure it — every `-dPDFSETTINGS` variant still segfaults; only `-dNoOutputFonts` helped, which destroys the text layer the whole template system depends on. A `pdftocairo -pdf` rewrite does cure the crash while keeping a real (17-run) text layer.

So the chain is now Inkscape → `gs pdfwrite` repair → `pdftocairo -pdf` repair → pdftocairo-SVG, each repair hop followed by an Inkscape retry, `{ converter, repaired }` reported.

## Considered Options

- **gs repair only** (original design): sufficient on Linux/Inkscape 1.4.3 — that build doesn't even reproduce the 009 segfault, which is why the gap survived initial verification.
- **`-dNoOutputFonts`**: cures the crash but outlines all text — defeats the purpose.
- **pdftocairo-SVG as the segfault answer**: always works but outlines the text, so scaffold can't propose text bindings; relegated to last resort.

## Consequences

- `pdftocairo -pdf` does **not** append `.pdf` to the output name — the repair step must pass the full filename (encoded as a comment in `src/convert/convert.mjs`).
- The macOS 1.4.4 + Ghostscript 10.03 combination is the known-bad case; when bumping either, re-run `LOCALHOST_TESTING.md` step 4.
