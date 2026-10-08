# VPS handoff — next-round tickets (#1–#6)

Message for whoever (or whatever) picks up the GitHub issues on the VPS.

## Prerequisites

- Node 22, `npm install`
- On PATH: Inkscape 1.4.x, poppler (`pdftocairo`, `pdftotext`), Ghostscript (`gs`)
- `.env` with `LADDER_LLM_PROVIDER` / `LADDER_LLM_MODEL` / provider key — **required only for real vision behavior in #4**; the test suites use injectable fakes and must pass without a key.

## Platform notes (Linux VPS ≠ macOS dev box)

- **Do not expect the 009 segfault.** ADR-0001 (`docs/adr/0001-convert-repair-chain.md`) exists because macOS/Inkscape 1.4.4 crashes on `LSB-2609-007-FHL-R00.pdf` and the `gs` repair does not cure it there. On Linux the chain's gs hop behaves differently; the repair-hop order is covered by fake-runner unit tests — green there is the contract, not a reproduced crash.
- **Font gotcha (see `wiki/Conversion.md`):** Inkscape only emits a real `<text>` layer for fonts it can resolve by family name. The corpus PDFs name `ArialMT`; stock Linux lacks it, so Inkscape output is outlined (original string survives on `aria-label`). Install a font actually **named** `ArialMT` (e.g. renamed Liberation Sans) before trusting any text-layer assertions or running scaffolds for real. macOS needs nothing (Arial ships).
- `LOCALHOST_TESTING.md` step 4's expectations ("converted with inkscape (repaired)" via the cairo hop) are **macOS-specific**. On Linux the gs hop may succeed first — same contract, different hop.

## Repo hygiene rules the suite enforces

- Tests write only to temp dirs (`templatesDir: tmp`). **Never scaffold into the repo's `templates/`** — `test/registry.test.js` asserts the registry stays exactly 7 templates, and stray dirs fail the suite.
- `npm test` runs a pretest build (`npm run build` regenerates `templates/index.js` + the UMD core). Commit regenerated artifacts together with template changes.
- Keep the suite green per ticket: **64/64** is the baseline at handoff.

## Work order

Frontier (start immediately): **#1 → #2 → #3** (small, independent), then **#4** on its own branch (the fat one). **#5** and **#6** are blocked by #4 via native dependency edges — the tracker will refuse to treat them as unblocked until #4 closes.

Vocabulary for tickets/branches lives in `CONTEXT.md`; design rationale in `docs/plans/vision-dimension-recovery.md`.
