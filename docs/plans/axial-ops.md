# Plan: axial ops — the staircase follows (spec #20)

**Status:** implemented (tickets #21–#23). Extends
[part-bindings](part-bindings.md) (spec #8) and
[llm-part-bindings](llm-part-bindings.md) (spec #15).

## Problem

The L3 mockup generator resizes totally because its geometry is computed
from params. Real templates resize only *bound* elements — and until this
plan the binding engine was axis-aligned by construction: `stretchX/Y`
scale only the matrix a/d components and `shiftX/Y` translate along user
axes. Diagonal members — the 003 staircase stringers above all — could
never bind, so the staircase stayed static while the platform grew.

## Op contract (geometry.mjs + editor.template.html, lockstep, parity-tested)

- **stretchAxial** `{ anchor, about?: min|max }` — lengthens the member
  along its *own* axis, angle preserved. Two levels:
  - matrix-rotated element (b≠0): scales the whole local x-axis column
    (a,b) — #21.
  - axis-aligned matrix with diagonal path data (the real-art case —
    Inkscape bakes rotation into `d`, every path carries
    `matrix(1.3333,0,0,-1.3333,e,f)`): `localAxis(matrix, d)` recovers the
    dominant straight run of the path and the op applies the linear map
    `P = I + (ratio−1)·u·uᵀ` about the pinned projection end to **every
    coordinate** of `d` (anchors and control points — exact for bends and
    curves by linearity), then fixes the translation so the pinned user
    point stays put. — #23.
  - `b=0` + straight-x `d` reduces byte-identically to `stretchX`.
- **shiftAxial** `{ anchor, pxPerUnit }` — translates along the element's
  local axis in user space (matrix column when rotated, data axis through
  the matrix otherwise). The proposal calibrates direction/rate; the
  engine stays dumb.
- Resilience rule throughout: unusable extents, degenerate axes, arcs-only
  paths → reported rows, never thrown.

## Proposal contract (proposeParts)

- Orientation classification: θ from the matrix when rotated; otherwise
  from the path data's dominant axis (`localAxis`, shared with the
  engine). ±12.5° bands → X-family / Y-family (today's rules unchanged);
  steeper → AXIAL.
- Axial span: bbox **projected** onto the measured axis matches the dim
  extent ±SPAN_TOL with both projected ends on the end planes →
  `stretchAxial`, `about` = datum-side projection end.
- Axial attach: wholly on the moving side, near projected point on the
  moving plane → `shiftAxial` at `s/comp` (comp = the axis's component
  along the measured axis; commented derivation in the code).
- Gates discovered by tests: a **dominance ≥2×** rule (a bolt triangle's
  hypotenuse must not make a blob "axial") and a **noise gate** (members
  shorter than the span-tolerance band keep axis-aligned behaviour — else
  arrowhead halves bind with ~47 px lateral drift).
- **FRAME_FACTOR** (1.5×): an element longer than 1.5× the dim extent that
  overlaps both end planes is sheet furniture (frame/border lines), not a
  member — skipped instead of poisoning the dim via all-or-nothing.
  Member-sized overlaps still forfeit the whole dim (spec #8 story 16).
- The LLM pass (#15) needed no new vocabulary: spans/attached map onto
  axial ops automatically via the candidate's orientation.

## Proof (003, the flagship)

Fresh scaffold of the real 003 PDF: dim4 (2500 platform height) binds its
far staircase stringer `path1492` (`stretchAxial about:"max"` — the
platform end is the datum side; the ground end follows the moving plane).
Rendering dim4 = 3000 from the scaffolded template: the stringer's
projected length grows 52.76 px (expected 500·s = 51.74 ± SPAN_TOL), the
user axis (−0.519, −0.855) is preserved to <1e-3 (eigen-direction of the
map), the pinned platform end does not move, the annotation reads 3000,
and the transform diff shows nothing unbound moved. Locked in
`test/geometry.test.js` ("#23 real art").

Known gaps on this art, locked with evidence in the tests: the near
stringer `path1491` stops 29 px (3 px over tolerance) short of the moving
plane, so only one stringer binds; no tread-row element cleanly attaches
(sub-tolerance hatch/arrowhead fragments near the plane; the larger
diagonals are stringer duplicates, not riders). Both are honest skips in
the report, achievable today via hand-authored JSON (`POST /bind`-style
entries survive re-scaffold by the #12 rules).

## Limitations (v1)

- Fixed-angle members only — the angle never changes with the value.
- Arcs (`A` commands) report unsupported for the d-level map (arcs/curves-
  only paths), never guessed.
- The axial attach rate assumes the member rides the moving plane along
  its own axis; compound 2-D deformation (shear) is out of scope.
