# Layers 1–3: what the system outputs for any PDF

The system never assumes what a drawing is. For every PDF it produces, in order of certainty:

1. **Faithful SVG (always)** — exact geometry from the PDF, no classification. Works on drawings it has never seen. (`ladder convert`)
2. **Generic metadata (always)** — title-block fields (title, customer, drawing no./rev, material, finishing, date, load) plus every dimension callout with value + position. Rules first; one optional vision pass fills blanks.
3. **Parametric SVG (only when a template matches)** — drawing families authored once (`ladder scaffold`) re-render with new values (`ladder render`).

An **unmatched** drawing simply stops at layers 1–2 — that is a normal, successful outcome, never an error.

# Templates: bind, don't redraw

A template is **the converted example SVG + bindings** from its text/geometry to named parameters — the real Illustrator art stays; bound values get substituted.

- **L1 — text:** replace bound text runs (title block, values). Covers most fields. Built.
- **L2 — geometry:** dimension lines/parts actually move. Not built (per-template effort; only where a line must move).
- **L3 — model:** code templates emitting SVG from a world model (`cat`/`cage`/`trolley` in `src/core`).

Templates live in `templates/<id>/{template.json, base.clean.svg}` and are matched by pooled signals (title keywords, drawing-no pattern, dimension signature) — see `src/templates/registry.mjs`.

**Known trap:** converted SVGs can carry a value twice — editable `<text>` *and* an outlined vector copy. Scaffold hides the outline duplicate (bbox coincidence via `inkscape --query-all`); without that, editing leaves a ghost outline.
