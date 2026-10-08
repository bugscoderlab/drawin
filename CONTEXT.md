# Drawin

PDF → SVG conversion and parametric re-rendering of Laddertech ladder drawings. Glossary for agents working in this repo — use these terms exactly; drift to the `_Avoid_` synonyms breaks grep-ability and confuses cross-references.

## Language

**Template**:
A converted drawing packaged for re-rendering: base art + params schema + bindings + sample. One template per drawing family.
_Avoid_: Master, source file, drawing (unqualified)

**Base art**:
The converted SVG a template renders from (`base.svg` / `base.clean.svg`), produced by the convert chain with coincident outline duplicates hidden.

**Scaffold**:
The automated build of a template from one PDF: convert → hide outline duplicates → propose params (title block + dimensions) → propose bindings, geometry, and formulas → emit editor.

**Binding**:
An association between a param and SVG node(s). Modes: `text` (exact string), `group` (runs sharing a style, partitioned into reading order), or geometry via a `geom` op.
_Avoid_: Link, mapping

**Geom binding**:
A transform-level binding on a dimension line, its moving-end arrowhead, and its value text, driven by a numeric param — the line stretches, arrowheads and centred text shift. Self-calibrating: px/mm derived from the drawing itself.
_Avoid_: Stretch rule, transform rule

**Dimension line**:
A dimension annotation recognised structurally: a thin straight span with arrowheads at both ends and its value centred on the line. Recognised by shape, not by content.

**Repair hop**:
A PDF rewrite inserted between Inkscape attempts in the convert chain when Inkscape crashes on the original. Two rewriters, in order: Ghostscript `pdfwrite`, then `pdftocairo -pdf`. Last resort is pdftocairo directly to SVG (outlines the text).
_Avoid_: Fallback, fix-up

**Outline synthesis**:
Replacing vector-outline dimension text (a cluster of glyph paths, no `<text>` node) with a real `<text>` element, positioned/sized from the outline cluster's bbox, so text and geometry bindings work on drawings whose annotations were never real text. (Implemented in `src/eval/vision.mjs`, driven by the zero-dims trigger in scaffold.)

**Unverified param**:
A param whose value came from a vision pass rather than the PDF text layer; badged in the editor and cross-checked against rules output when a conflict exists. Flows into template.json as `unverified: true`; values that fail the plausibility gate (implausible px/mm, or no arrowed dimension line) are dropped and reported in the scaffold output.

**Preserve-by-default**:
Re-scaffold semantics (issue #3): an existing template dir is merged (formulas, labels, named constants, and hand-made id-bindings whose ids still exist are kept; outline hiding, value bindings, and geometry bindings are recomputed). Wiping requires an explicit `--force`.
_Avoid_: Merge mode, safe scaffold

**Proof**:
The per-template visual verification: original render vs edited render side by side, plus a binding report, written to `preview/<templateId>/`.
