# Part bindings — geometry follows dimensions — design (agreed 2026-10-09)

Status: **implemented** (tickets #9–#13): the `about` end on stretch ops in `src/templates/geometry.mjs` (CLI) and `src/templates/editor.template.html` (editor port), the part-proposal stage in `src/eval/scaffold.mjs` (`proposeGeometry` stage 3, `proposeParts`), the preserve-by-default extension in the re-scaffold merge step. Tests: `test/geometry.test.js` (units → synthetic-rows proposal → real-art assertion → 004 e2e), `test/rescaffold.test.js` (preserve seam), `test/proof-bind.test.js` (`--set` override), editor port parity in `test/geometry.test.js`. Proof: `preview/lsb-2607-004-fhl-r00/` — generated from a fresh scaffold of `LSB-2607-004-FHL-R00.pdf` with `ladder proof <dir> --set dim1=1000` (provenance in the Proof section below). Spec: issue #8.

## Problem

Editing a dimension value moved only the *annotation*: the dimension line stretched, the arrowhead and the value text moved, but the part geometry the dimension measures — flat bars, rails, brackets — stayed put. The drawing showed "1000" over geometry still 500 wide, and the dimension line no longer touched the part it measures.

## Decision: the same two ops, one optional schema field — no new render level

Terminology (CONTEXT.md): a geom binding on a dimension-line cluster is an **annotation binding**; on part geometry it is a **Part binding**. The feature extends **L2** — no new render level, no part-aware renderer.

**Op contract** — the one engine-visible schema change (`#9`): `stretchX`/`stretchY` gain an optional `about: "min" | "max"` naming which end of the element's *local extent* stays pinned; the other end tracks by `value/anchor`.

- Omitted `about` = `"min"` = today's behaviour: the local-origin end (the matrix translation) stays pinned. Every existing template renders byte-identically.
- `"max"` pins the far end of the drawn extent — the endpoint of the element's `d` attribute farthest from its local origin (parsed by `localExtent` in `geometry.mjs`; curve control points don't count, exact for the line-based art this engine binds). This is how right-anchored part geometry widens: the 004 cap bars have their local origin at the moving rail and their path extending negative to the datum rail, so scaling about the origin would grow them the wrong way. `about: "max"` holds the datum end while the rail end tracks the value.
- `shiftX`/`shiftY` are unchanged: translate by `(value − anchor) × pxPerUnit`.
- A right-datum dimension needs no mirror ops: the *proposal* classifies against the correct moving end; the same two ops suffice.

## Proposal contract (scaffold, `proposeGeometry` stage 3 → `proposeParts`)

For each dimension whose annotation bound (stages 1–2: structural recognition of the arrowed dimension line, then line/arrowhead/text bindings), the part-proposal stage classifies the axis-aligned elements in a **locality box** around the dim line — ±2× the dim extent on the measured axis, ±1× on the cross axis (constants `LOCALITY`, locked in `test/geometry.test.js`). No view segmentation exists; "same view" is operationalised purely as this box.

- **Span rule** (`#10`): an element whose measured-axis extent matches the dim extent within ±10% (`SPAN_TOL`) with both ends on the dim's end planes becomes a `stretch` binding. Its `about` end is derived from which side of the element's local extent the datum plane sits on (the element's matrix translation is its local-origin end).
- **Attach rule** (`#11`): an element wholly on the moving side of the datum plane with its near edge on the moving-end plane (within tolerance) — the far rail, its bolts, its brackets — becomes a `shift` binding at the **full rate** (the dim's own extent/value). Datum-side attachments stay unbound: the drawing grows from a stable reference edge.
- **All-or-nothing** (`#11`): an element that overlaps both end planes without matching the span rule, or whose transform is not axis-aligned, makes the whole dimension's part proposal **ambiguous** — every binding proposed for that dim is dropped and its claims released. A half-moved assembly is worse than an honestly unedited one.
- **Exclusion**: the existing `claimed` set (dim line, both arrowheads, text glyphs) extends to part elements — one element binds to at most one dimension (first-come wins), and the dim-line cluster itself is never re-classified as a part (annotations move exactly once, never double-bound).

## Calibration

`pxPerUnit` is the dimension's own extent/value — the same self-calibration annotation bindings use, so non-uniformly-scaled shop art needs no configuration. The plausibility gate (`[0.005, 2]` px/mm) runs before anything is emitted. On **re-scaffold, calibration is always re-derived from the fresh art** — a stale `anchor`/`pxPerUnit` can never survive (`#12`).

## Ambiguity policy

Every skip is counted and reported per dimension in the scaffold report — `parts: dim1 86 bound, 160 skipped`, or `0 bound, skipped: ambiguous` — never silent. (On the dense 004 sheet every vertical dim lands `skipped: ambiguous` in v1 — one unclassifiable element in the locality box forfeits the whole dimension — while the horizontal cage width binds its 86 elements.) Ambiguous dims remain achievable: hand-add the part binding to `template.json` directly (the editor/`POST /bind` surface does not author geom bindings; bindings remain scaffold output + hand-authored JSON). Missing ids, non-numeric values, and unsupported transforms are reported in the binding report, never thrown (resilience rule, unchanged).

## Preserve semantics (re-scaffold, extends issue #3)

- A previous **geom binding** (hand-made or not) is a carry candidate iff **all its ids exist in the fresh art AND its param's value is unchanged** (the params id+value rule — dim ids are positional).
- It is *kept* only when the fresh proposal left its dim untouched — a dim with fresh part proposals is reproduced, because **auto-proposed bindings are always recomputed, never carried** — and when none of its ids was fresh-bound elsewhere.
- The carried binding keeps **membership** (ids, param, op incl. `about`); its **calibration** (`anchor`/`pxPerUnit`) is re-derived from the fresh art.
- Net effect needs no auto-vs-hand marker: fresh proposals ∪ preserved-not-reproduced, calibrations always fresh. `--force` wipes everything as today.

## Cost & caching

None extra. The part-proposal stage consumes the `inkscape --query-all` bbox rows and the clean SVG that scaffold already computes; no new processes, calls, or caches. (The rescaffold preserve seam reuses the `calib` map the geometry pass already returns.)

## Editor surface

`editor.template.html` carries a faithful inline port of `geometry.mjs` (including `extent1D` for `about: "max"`); `test/geometry.test.js` runs identical binding vectors through both engines and asserts byte-identical SVGs (port parity). The editor badge reports bound/skipped counts. The browser editor only *applies* part bindings; there is no editor UI for inspecting or editing them (out of scope).

## V1 limitations

- **Same-view only**: the locality guard is the whole "same view" story; look-alike geometry in other views of the sheet is only out of reach by distance. Cross-view part movement needs view segmentation — a separate design.
- **Labels and leader arrows (FLATBAR callouts) are untouched**, even when a large edit orphans them: the callout text and its leader stay where they were drawn while the part they describe moves away. A documented, accepted v1 artifact — visible in the 004 dim1=1000 proof.
- **Ambiguity is conservative**: one bad element in the locality box forfeits the whole dimension's part proposal; such dims stay hand-bindable.
- Local extent is parsed from path endpoints; elements whose extent lives in curve control points (or unsupported commands) have no reliable extent and are treated as unclassifiable.

## Proof

`ladder proof <dir>` renders the template's original values beside its `sample` values. A `--set param=value` option (repeatable) overrides sample params for the AFTER image — the 004 proof uses `--set dim1=1000` so the comparison shows the widened cap with the bars meeting the moved rail, not just the ×1.1 sample. Artifacts land in `preview/<templateId>/` (`1_BEFORE_original.png`, `2_BEFORE_base.png/.svg`, `3_AFTER_changed.png/.svg`, binding report on stdout).

**Provenance.** The checked-in `templates/lsb-2607-004-fhl-r00/` predates part bindings and was deliberately *not* re-scaffolded for this proof: the current dim proposer finds a seventh dimension (`450.00`) on this sheet, so an in-place re-scaffold would renumber every dim and rewrite the maintainer's hand-tuned formulas — a template-editorial decision beyond this ticket. The proof instead uses a fresh `llm:false` scaffold of the same `LSB-2607-004-FHL-R00.pdf` (identical base art, template id `lsb-2607-004-fhl-r00`): dim1 binds 86 elements (4 cap-bar spans + 82 moving-end rail-assembly attachments); dims 2–7 report `skipped: ambiguous`.

The machine-checked twin of the visual proof is the `#11 e2e` test in `test/geometry.test.js` (rendered-outcome assertion: stretched bar ends land on the shifted-rail position within the span tolerance, the annotation reads 1000, FLATBAR callouts unmoved).

## Companion notes

- Glossary (CONTEXT.md): **Geom binding** / **Part binding** / **Preserve-by-default** were pre-seeded in b28158e and match the shipped behaviour; no change needed.
- No ADR (deliberately, per spec): cheap to reverse, and the repo pattern for feature designs is a plan doc at implementation time.
