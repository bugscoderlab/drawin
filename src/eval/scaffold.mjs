// Scaffold a template (and its editor HTML) from any PDF — the missing "upload PDF" hop.
//
//   node src/eval/scaffold.mjs "LSB-2607-003-RHC-R00.pdf"
//
// Steps: convert (Inkscape) -> hide outline duplicates -> propose bindings from the
// drawing's own text -> write templates/<id>/template.json -> build the editor HTML.
// Conversion is native (Inkscape/poppler), which is why this lives in the CLI.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { textRuns, findRun, orderedLists } from '../templates/render.mjs';
import { localExtent } from '../templates/geometry.mjs';
import { parseQueryAll, coincidentOutlineIds, hideIds, svgIds, mergeGlyphTexts } from '../templates/authoring.mjs';
import { buildEditor } from './makeEditor.mjs';
import { convertPdf } from '../convert/convert.mjs';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape';   // container/VPS: resolve via PATH (still needed for --query-all)
const norm = (s) => String(s).replace(/\s+/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Dimension params are positional: dim1…dim8. */
const isDim = (id) => /^dim\d+$/.test(id);

function locate(runs, value) {
  const t = norm(value);
  if (runs.some((r) => norm(r.text) === t)) return { mode: 'text', runs: 1 };
  const g = findRun(runs, value, 'group');
  if (g.length) return { mode: 'group', runs: g.length };
  return null;
}

const TB_LABEL = /customer|date|scale|drawn|checked|revision|approved|material|finish|weight|sheet|do not|quotation|name:|co\. no/i;

/** Bbox of the title-block region from its label texts (padded); null when no labels found. */
function titleBlockRect(runs) {
  const anchors = runs.filter((r) => TB_LABEL.test(r.text));
  if (anchors.length < 2) return null;
  const xs = anchors.map((r) => r.x), ys = anchors.map((r) => r.y);
  const PAD = 20;
  return { x0: Math.min(...xs) - PAD, x1: Math.max(...xs) + PAD, y0: Math.min(...ys) - PAD, y1: Math.max(...ys) + PAD };
}

/** True when a letter run sits on the same line/column as the token — title-block rows
 *  like "Height :6650", "Date:...2026", "Tel: ... 40150" are rejected this way. Real
 *  dims sit in whitespace; tight spans keep nearby labels from rejecting them. */
function inlineWithLetter(glyphs, vertical, letters) {
  if (!glyphs.length) return false;
  const xs = glyphs.map((g) => g.x), ys = glyphs.map((g) => g.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const l of letters) {
    if (vertical) {
      if (Math.abs(l.x - cx) <= 15 && l.y >= Math.min(...ys) - 6 && l.y <= Math.max(...ys) + 6) return true;
    } else {
      // rows: letters usually trail the value ("...6650 mm", "2026)"), so trail farther
      if (Math.abs(l.y - cy) <= 10 && l.x >= Math.min(...xs) - 12 && l.x <= Math.max(...xs) + 40) return true;
    }
  }
  return false;
}

function dimensionTokens(runs, pageH) {
  const out = [], seen = new Set();
  const TH = 12;   // max gap along the advance axis between consecutive glyphs
  const THX = 12;  // max drift on the fixed axis (keeps adjacent columns/rows apart)
  const letters = runs.filter((r) => /[A-Za-z]/.test(r.text));
  const tb = titleBlockRect(runs);
  for (const list of orderedLists(runs)) {
    let acc = '', coord = null, fixed = null, glyphs = [];
    const flush = () => {
      if (acc && /^\d{3,6}(\.\d{1,2})?$/.test(acc) && !seen.has(acc)) {
        const vertical = glyphs.length && Math.abs(glyphs[0].dir.b) > Math.abs(glyphs[0].dir.a);
        const cx = glyphs.reduce((s, g) => s + g.x, 0) / glyphs.length;
        const cy = Math.min(...glyphs.map((g) => g.y));
        const inTb = tb && cx >= tb.x0 && cx <= tb.x1 && cy >= tb.y0 && cy <= tb.y1;
        if (!inTb && !inlineWithLetter(glyphs, vertical, letters)) {
          seen.add(acc);
          out.push({ value: acc, vertical: !!vertical, glyphs: glyphs.map((g) => ({ id: g.id, x: g.x, y: g.y })) });
        }
      }
      acc = ''; coord = null; fixed = null; glyphs = [];
    };
    for (const r of list) {
      const vertical = Math.abs(r.dir.b) > Math.abs(r.dir.a);
      const c = vertical ? r.y : r.x;   // advance-axis coordinate
      const f = vertical ? r.x : r.y;   // fixed-axis coordinate
      const numeric = /^[0-9.,]+$/.test(norm(r.text));
      if (!numeric) { flush(); continue; }
      if (coord !== null && Math.abs(f - (fixed ?? f)) > THX) flush(); // drifted to another column/row
      if (coord === null || Math.abs(c - coord) <= TH) {
        if (coord === null) fixed = f;
        acc += norm(r.text); coord = c; glyphs.push(r);
      } else { flush(); acc = norm(r.text); coord = c; fixed = f; glyphs = [r]; }
    }
    flush();
  }
  return out;
}

function propose(runs, pageH) {
  const props = [], used = new Set();
  const add = (id, label, value, extra) => {
    if (!value || used.has(id) || used.has(norm(value))) return;
    const loc = locate(runs, value); if (!loc) return;
    props.push({ id, label, value, mode: loc.mode, runs: loc.runs, ...(extra || {}) }); used.add(id); used.add(norm(value));
  };
  const texts = [...new Set(runs.map((r) => r.text.trim()).filter(Boolean))];

  add('drawingNo', 'Drawing No.', texts.find((t) => /^LSB[-/][0-9A-Za-z/-]{6,}$/.test(t)));
  add('customer', 'Customer', texts.find((t) => /SDN\.?\s*BHD$/i.test(t) && !/LADDERTECH|LADDER\s*TECH|NEW\s*AGE|NAR\b/i.test(t)));
  add('workingLoad', 'Working Load', texts.find((t) => /^\d{2,3}\s?KG$/i.test(t)));
  // title rows are commonly labelled "Product Name : X" — the label is not
  // part of the value (and ':' is outside the title charset)
  const stripLabel = (t) => t.replace(/^(product\s*name|title|description)\s*:\s*/i, '');
  add('productName', 'Title', texts.filter((t) => /^[A-Z][A-Z0-9 ,&()/.-]{15,}$/.test(stripLabel(t))).map(stripLabel).sort((a, b) => b.length - a.length)[0]);
  let i = 0;
  for (const d of dimensionTokens(runs, pageH)) {
    if (i >= 8) break;
    add(`dim${i + 1}`, `Dimension ${i + 1}`, d.value, { geom: { vertical: d.vertical, glyphs: d.glyphs } });
    i++;
  }
  return props;
}

/**
 * L2 geometry proposal (PLAN 1C.7): for each numeric dim, find its dimension
 * line in the query-all rows and emit geometry bindings so the line, its
 * moving-end arrowhead, and the text centre all track the value.
 *
 * A dimension line is recognised structurally — a thin straight path with an
 * arrowhead (small filled path) at each end that spans the dim text — so no
 * drawing scale is assumed. px/mm is self-calibrated per dim (extent/value);
 * shop drawings are frequently not uniformly scaled, so no cross-dim
 * consensus is needed or wanted. Conservative: any doubt -> no binding.
 *
 * The pass runs in three stages so the exclusion rules hold without ordering
 * tricks: (1) recognise every dim's line, (2) emit the annotation bindings
 * (line, arrowhead, text) and claim the whole cluster, (3) run the
 * part-proposal stage against the claimed set, so a dim line is never
 * re-classified as a part and no element binds twice (#10).
 *
 *   proposeGeometry(rows, props, svg) -> { bindings, lines: [paramId], parts: [{ param, bound, skipped, ambiguous? }], calib, annotated }
 *
 *  `calib` maps each recognised param to { v, s } (dim value and its
 *  self-calibrated px/mm) — the re-scaffold carry-over (ticket #12) re-derives
 *  a preserved part binding's anchor/pxPerUnit from it. `annotated` is the
 *  set of params that received fresh ANNOTATION bindings in this run (stage 2)
 *  — the preserve step never carries a previous binding whose param was
 *  auto-reposed here: recomputed, never carried (except ambiguous dims). */
export function proposeGeometry(rows, props, svg = '') {
  const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isNaN(n) ? null : n; };
  const cleanIds = svg ? svgIds(svg) : null;
  const usable = rows.filter((r) => r.w > 0 && r.h > 0 && (!cleanIds || cleanIds.has(r.id)));
  const small = usable.filter((r) => Math.max(r.w, r.h) <= 14 && Math.min(r.w, r.h) > 0);
  const endsOf = (r, vertical) => vertical
    ? [{ x: r.x + r.w / 2, y: r.y }, { x: r.x + r.w / 2, y: r.y + r.h }]
    : [{ x: r.x, y: r.y + r.h / 2 }, { x: r.x + r.w, y: r.y + r.h / 2 }];
  const arrowAt = (pt) => small
    .filter((s) => Math.abs(s.x + s.w / 2 - pt.x) <= 7 && Math.abs(s.y + s.h / 2 - pt.y) <= 7)
    .sort((p, q) => (Math.abs(p.x + p.w / 2 - pt.x) + Math.abs(p.y + p.h / 2 - pt.y)) - (Math.abs(q.x + q.w / 2 - pt.x) + Math.abs(q.y + q.h / 2 - pt.y)))[0];

  const transformOf = (id) => {
    const m = svg.match(new RegExp(`<[a-zA-Z][^>]*?\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*?\\btransform="([^"]*)"`));
    return m ? m[1] : null;
  };
  const matrixOf = (id) => transformOf(id)?.match(/matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)/);
  const tagOf = (id) => {
    const m = svg.match(new RegExp(`<[a-zA-Z][^>]*?\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
    return m ? m[0] : null;
  };

  // Stage 1: recognise each dim's dimension line (claimed keeps lines unique).
  const claimed = new Set();
  const recs = [];
  for (const p of props) {
    const g = p.geom;
    const v = g && num(p.value);
    if (!g || v === null || v <= 0 || !g.glyphs?.length) continue;
    const xs = g.glyphs.map((x) => x.x), ys = g.glyphs.map((x) => x.y);
    const vertical = g.vertical;
    const cx = vertical ? xs.reduce((a, b) => a + b, 0) / xs.length : (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = vertical ? (Math.min(...ys) + Math.max(...ys)) / 2 : ys.reduce((a, b) => a + b, 0) / ys.length;
    const cands = usable.filter((r) => {
      if (claimed.has(r.id)) return false;
      if (vertical) {
        return r.w <= 3 && r.h >= 12 && Math.abs(r.x + r.w / 2 - cx) <= 8 && cy >= r.y - 10 && cy <= r.y + r.h + 10;
      }
      return r.h <= 3 && r.w >= 12 && Math.abs(r.y + r.h / 2 - cy) <= 8 && cx >= r.x - 10 && cx <= r.x + r.w + 10;
    });
    const withArrows = cands.filter((r) => {
      const ends = endsOf(r, vertical);
      return arrowAt(ends[0]) && arrowAt(ends[1]);
    });
    if (!withArrows.length) continue;
    withArrows.sort((a, b) => (vertical ? b.h - a.h : b.w - a.w));
    const line = withArrows[0];
    const extent = vertical ? line.h : line.w;
    const s = extent / v;                    // px per mm, self-calibrated
    if (s < 0.005 || s > 2) continue;        // not a believable scale -> skip
    claimed.add(line.id);
    // The matrix translation sits on the datum (fixed) end of the line; the
    // arrowhead at the OTHER end moves with the stretched line.
    const ends = endsOf(line, vertical);
    const m = matrixOf(line.id);
    let datum = ends[0], moving = null;
    if (m) {
      const oe = +m[5], of = +m[6];
      const dFix = Math.min(Math.hypot(ends[0].x - oe, ends[0].y - of), Math.hypot(ends[1].x - oe, ends[1].y - of));
      moving = ends.find((e) => Math.hypot(e.x - oe, e.y - of) > dFix + 1) || null;
      if (moving) datum = ends.find((e) => e !== moving);
    }
    recs.push({ p, line, extent, s, vertical, datum, moving });
  }

  // Stage 2: annotation bindings — the line stretches, the moving-end
  // arrowhead and the text centre shift. The whole cluster (both arrowheads
  // included) joins the claimed set so stage 3 never re-classifies it.
  const bindings = [];
  for (const r of recs) {
    const { p, line, s, vertical, moving } = r;
    const v = num(p.value);
    const axis = vertical ? 'Y' : 'X';
    bindings.push({ ids: [line.id], param: p.id, geom: { op: `stretch${axis}`, anchor: v } });
    const ends = endsOf(line, vertical);
    for (const e of ends) { const a = arrowAt(e); if (a) claimed.add(a.id); }
    const arrow = moving && arrowAt(moving);
    if (arrow) bindings.push({ ids: [arrow.id], param: p.id, geom: { op: `shift${axis}`, anchor: v, pxPerUnit: s } });
    const g = p.geom;
    for (const gl of g.glyphs.map((x) => x.id).filter(Boolean)) claimed.add(gl);
    bindings.push({ ids: g.glyphs.map((x) => x.id).filter(Boolean), param: p.id, geom: { op: `shift${axis}`, anchor: v, pxPerUnit: s / 2 } });
  }

  // Stage 3: part bindings — the geometry the dimension measures (spec #8).
  const parts = [];
  for (const r of recs) {
    const pr = proposeParts(usable, claimed, r, matrixOf, tagOf);
    bindings.push(...pr.bindings);
    parts.push({ param: r.p.id, bound: pr.bound, skipped: pr.skipped, ...(pr.ambiguous ? { ambiguous: true } : {}) });
  }
  return {
    bindings,
    lines: recs.map((r) => r.p.id),
    parts,
    calib: Object.fromEntries(recs.map((r) => [r.p.id, { v: num(r.p.value), s: r.s }])),
    annotated: new Set(recs.map((r) => r.p.id)),
    // internals for the LLM part-proposal pass (spec #15): the deterministic
    // stage's per-dim geometry, candidate pool, and exclusion set, so the
    // model can pick membership within exactly the same guard rails.
    recs,
    usable,
    claimed,
    matrixOf,
  };
}

// Locality guard (spec #8): only elements near the dim line's own view are
// part candidates. The box around the dim line spans ±2× the dim extent on
// the measured axis and ±1× on the cross axis (constants locked in
// test/geometry.test.js).
const LOCALITY = { along: 2, cross: 1 };

/** Is `r` inside the dim line's locality box? (Shared by the deterministic
 *  span/attach rules and the LLM part pass — one definition of the guard.) */
export function inLocality(r, line, extent, vertical) {
  const axis = vertical ? 'y' : 'x';
  const cross = vertical ? 'x' : 'y';
  const len = (q, a) => (a === 'y' ? q.h : q.w);
  const mid = (q, a) => q[a] + len(q, a) / 2;
  const halfA = len(line, axis) / 2 + LOCALITY.along * extent;
  const halfC = len(line, cross) / 2 + LOCALITY.cross * extent;
  return Math.abs(mid(r, axis) - mid(line, axis)) <= halfA
    && Math.abs(mid(r, cross) - mid(line, cross)) <= halfC;
}

/** Which end of the element's LOCAL extent stays pinned for a span binding:
 *  the end on the datum side. "min" pins the local-origin end (its user
 *  position is the matrix translation); "max" pins the far end. Shared by the
 *  deterministic span rule and the LLM part pass (spec #15). */
export function deriveAbout(matrixOf, r, { vertical, datumC }) {
  const axis = vertical ? 'y' : 'x';
  const len = (q, a) => (a === 'y' ? q.h : q.w);
  const r0 = r[axis], r1 = r0 + len(r, axis);
  const m = matrixOf(r.id);
  const o = m ? (axis === 'x' ? +m[5] : +m[6]) : r0;
  const oEnd = Math.abs(o - r0) <= Math.abs(o - r1) ? 'min' : 'max';
  const dEnd = Math.abs(datumC - r0) <= Math.abs(datumC - r1) ? 'min' : 'max';
  return oEnd === dEnd ? 'min' : 'max';
}
// Span rule tolerance: measured-axis extent and end positions must match the
// dim within ±10% of the dim extent. Exported for the e2e landing assertion,
// which derives its bound from this admitted tolerance (locked constant).
export const SPAN_TOL = 0.10;

// Orientation bands (spec #20, ticket #22): a candidate's angle θ = atan2(b,
// a) mod π from its matrix decides which rule family applies. Within ±12.5°
// of horizontal/vertical the element keeps the axis-aligned rules (for an
// axis-aligned element the bbox side along the measured axis IS its
// projection — today's behaviour unchanged); anything steeper classifies
// AXIAL and is measured by its bbox projection onto the measured axis.
const AXIS_BAND = (12.5 * Math.PI) / 180;
const orientOf = (m) => {
  if (!m) return 'X';                    // no transform: identity, the axis-aligned default
  const th = ((Math.atan2(+m[2], +m[1]) % Math.PI) + Math.PI) % Math.PI;
  if (th <= AXIS_BAND || th >= Math.PI - AXIS_BAND) return 'X';
  if (Math.abs(th - Math.PI / 2) <= AXIS_BAND) return 'Y';
  return 'AXIAL';
};

/** Part-proposal stage (spec #8, tickets #10/#11/#22): for a dimension whose
 *  annotation bound, classify the elements inside the locality box.
 *  Span rule (#10): an element whose measured-axis extent matches the
 *  dim extent (±SPAN_TOL) with both ends on the dim's end planes becomes a
 *  stretch part binding; the `about` end is the datum side of the element's
 *  local extent. Attach rule (#11): an element wholly on the moving side of
 *  the datum plane with its near edge on the moving-end plane (±tol) — the
 *  far rail, its bolts and brackets — becomes a shift part binding at the
 *  full rate (the dim's own extent/value). Elements attached to the datum
 *  end stay unbound, as do candidates matching no rule (counted skipped).
 *
 *  Rotated candidates (#22): the old "non-axis-aligned -> ambiguous" rule is
 *  replaced by orientation classification. X/Y-family candidates (within
 *  ±12.5° of horizontal/vertical) run the same axis-aligned rules as before.
 *  AXIAL candidates run the projected rules: span -> stretchAxial about the
 *  datum-side local end; attach -> shiftAxial riding the element's own axis
 *  at s_along = s / sin(α). Rotated annotation TEXT is never a part
 *  candidate, and an AXIAL candidate without a usable path extent (the
 *  engine's pinned end needs the local x extent) counts as skipped,
 *  reported — neither makes the dim ambiguous.
 *
 *  All-or-nothing (#11): an element that overlaps BOTH end planes without
 *  matching a rule makes the WHOLE dimension's part proposal ambiguous —
 *  every binding proposed for it is dropped, its claims released, and the
 *  dim reports `ambiguous: true` ("skipped: ambiguous" in the report). A
 *  half-moved assembly is worse than an honestly unedited one.
 *
 *  One element binds to at most one dimension: candidates come from the
 *  shared `claimed` set and every bound id joins it. */
function proposeParts(usable, claimed, { p, line, extent, vertical, datum, moving }, matrixOf, tagOf) {
  const v = parseFloat(String(p.value).replace(/,/g, ''));
  const axis = vertical ? 'y' : 'x';
  const lineLen = { x: line.w, y: line.h };
  const d0 = line[axis];
  const d1 = d0 + lineLen[axis];
  const datumC = datum[axis];
  const movingC = moving && moving[axis];
  const dir = movingC === null || movingC === undefined ? 1 : Math.sign(movingC - datumC) || 1;
  const tol = SPAN_TOL * extent;
  const s = extent / v;                    // full rate: the dim's own px/mm

  const len = (r, a) => (a === 'y' ? r.h : r.w);
  const bindings = [];
  let bound = 0, skipped = 0, ambiguous = false;
  for (const r of usable) {
    if (claimed.has(r.id)) continue;
    if (!inLocality(r, line, extent, vertical)) continue;  // locality guard
    const m = matrixOf(r.id);
    // r0/r1 are the element's bbox ends on the measured axis — for an AXIAL
    // candidate this is exactly its bbox projected onto the measured axis.
    const r0 = r[axis], r1 = r0 + len(r, axis);
    if (orientOf(m) === 'AXIAL') {
      const tag = tagOf(r.id);
      // Rotated annotation text is never a part candidate (spec #20), and an
      // axial op needs a path-like local x extent (the engine's pinned end
      // for about "max"; the about derivation below). Either way: skipped
      // and reported — never a part, never ambiguous.
      const ext = tag && !/^<(?:text|tspan)\b/i.test(tag) ? localExtent(tag, 'x') : null;
      if (!ext) { skipped++; continue; }
      if (Math.abs(r1 - r0 - extent) <= tol && Math.abs(r0 - d0) <= tol && Math.abs(r1 - d1) <= tol) {
        // Axial span rule: the projected bbox spans the dim extent with both
        // ends on the end planes -> stretch along the element's own axis
        // (angle preserved); the pinned end is the datum side of the local
        // extent (deriveAbout; the engine's "min" pins the local-origin end).
        const about = deriveAbout(matrixOf, r, { vertical, datumC });
        bindings.push({ ids: [r.id], param: p.id, geom: { op: 'stretchAxial', about, anchor: v } });
        claimed.add(r.id);
        bound++;
        continue;
      }
      if (moving && Math.abs((dir > 0 ? r0 : r1) - movingC) <= tol && (dir > 0 ? r1 : r0) * dir >= datumC * dir) {
        // Axial attach rule: the whole projected bbox lies on the moving side
        // with its near point on the moving-end plane -> the element rides
        // the plane rigidly along its own axis. Rate derivation: the plane
        // travels s px per mm along the measured axis; translating the
        // element d user units along its own axis (length |(a,b)|) shifts
        // its measured-axis projection by d·sin(α), where α is the axis
        // elevation from the measured plane and sin(α) = the axis's
        // component along the measured axis over its length — |a|/|(a,b)|
        // for a horizontal dim, |b|/|(a,b)| for a vertical one (the fraction
        // of axial travel that lands on the measured axis). Keeping the near
        // projected point on the plane needs d·sin(α) = s·Δv per Δv mm, so
        // pxPerUnit = s / sin(α). The AXIAL band guarantees
        // sin(α) ≥ sin(12.5°) ≈ 0.216, so the rate is always finite.
        const sinA = Math.abs(vertical ? +m[2] : +m[1]) / Math.hypot(+m[1], +m[2]);
        bindings.push({ ids: [r.id], param: p.id, geom: { op: 'shiftAxial', anchor: v, pxPerUnit: s / sinA } });
        claimed.add(r.id);
        bound++;
        continue;
      }
      skipped++;
      if (r0 <= d0 + tol && r1 >= d1 - tol) ambiguous = true;   // overlaps both end planes
      continue;
    }
    if (Math.abs(r1 - r0 - extent) <= tol && Math.abs(r0 - d0) <= tol && Math.abs(r1 - d1) <= tol) {
      // Span rule: the pinned end is the datum side of the element's local
      // extent (deriveAbout; the engine's "min" pins the local-origin end).
      const about = deriveAbout(matrixOf, r, { vertical, datumC });
      bindings.push({ ids: [r.id], param: p.id, geom: { op: `stretch${axis.toUpperCase()}`, about, anchor: v } });
      claimed.add(r.id);
      bound++;
      continue;
    }
    if (moving && Math.abs((dir > 0 ? r0 : r1) - movingC) <= tol && (dir > 0 ? r1 : r0) * dir >= datumC * dir) {
      // Attach rule: the element's datum-facing edge sits on the moving-end
      // plane and the whole element lies on the moving side — the rail
      // assembly follows the moving end at the full rate.
      bindings.push({ ids: [r.id], param: p.id, geom: { op: `shift${axis.toUpperCase()}`, anchor: v, pxPerUnit: s } });
      claimed.add(r.id);
      bound++;
      continue;
    }
    skipped++;
    if (r0 <= d0 + tol && r1 >= d1 - tol) ambiguous = true;   // overlaps both end planes
  }
  // All-or-nothing: one unclassifiable element forfeits the whole dimension.
  if (ambiguous) {
    for (const b of bindings) claimed.delete(b.ids[0]);
    return { bindings: [], bound: 0, skipped, ambiguous: true };
  }
  return { bindings, bound, skipped };
}

/** Dim geometry in LLM-facing form: measure axis, text position, glyph span. */
function geomMeta(g) {
  if (!g?.glyphs?.length) return null;
  const xs = g.glyphs.map((x) => x.x), ys = g.glyphs.map((x) => x.y);
  const step = g.glyphs.length > 1
    ? Math.abs(g.glyphs[1].x - g.glyphs[0].x) || Math.abs(g.glyphs[1].y - g.glyphs[0].y) || 7
    : 7;
  const span = (g.vertical ? Math.max(...ys) - Math.min(...ys) : Math.max(...xs) - Math.min(...xs)) + step;
  const r = (n) => Math.round(n * 10) / 10;
  const pos = g.vertical
    ? [r(xs.reduce((a, b) => a + b, 0) / xs.length), r((Math.min(...ys) + Math.max(...ys)) / 2)]
    : [r((Math.min(...xs) + Math.max(...xs)) / 2), r(ys.reduce((a, b) => a + b, 0) / ys.length)];
  return { axis: g.vertical ? 'y' : 'x', pos, spanPx: r(span) };
}

/** A demo set of changed values so the "Sample changes" button works on any template.
 *  Constants are physical values — the demo must not move them. */
function makeSample(props) {
  const s = {};
  for (const p of props) {
    if (p.isConst) continue;
    const v = String(p.value);
    if (/^[0-9.,]+$/.test(v)) {
      const n = parseFloat(v.replace(/,/g, ''));
      if (!Number.isNaN(n)) s[p.id] = (n * 1.1).toFixed(v.includes('.') ? 2 : 0);
    } else if (p.id === 'customer') s[p.id] = 'ACME TOWER CRANES SDN BHD';
    else if (p.id === 'drawingNo') s[p.id] = v.replace(/R\d{2}$/, 'R99').replace(/\d{2}$/, '99');
    else if (p.id === 'workingLoad') s[p.id] = '200KG';
    else if (p.id === 'productName') s[p.id] = v + ' - REV B';
  }
  return s;
}

/**
 * Vision dimension recovery step (issue #4): the vision model proposes each
 * dim's {value, position}; the located outline glyph cluster is replaced by a
 * real <text> node so the regular proposal path binds it like any other dim.
 * The plausibility gate (proposeGeometry's [0.005, 2] px/mm check, which also
 * drops dims lacking an arrowed dimension line) runs BEFORE anything is
 * emitted: a rejected dim loses its param AND its synthesized text, and the
 * rejection is counted in `vision` (reported by the caller, never silent).
 * The raw reply is cached in vision.json beside the template, keyed by a
 * content hash of the source PDF (issue #5) — a second scaffold of the same
 * source replays the cache instead of paying for another vision call.
 * Mutates props/vision; returns the (possibly rewritten) clean SVG.
 */
async function recoverAndBindVisionDims({ file, dir, rows, clean, pageH, props, vision, llm }) {
  const { recoverVisionDims } = await import('./vision.mjs');
  const pageW = Number((clean.match(/<svg[^>]*\bwidth="([\d.]+)"/) || [])[1]) || 0;
  const rec = await recoverVisionDims({
    file, rows, svg: clean, pageW, pageH,
    ...(typeof llm === 'function' ? { call: llm } : {}),
    cache: {
      path: join(dir, 'vision.json'),
      hash: createHash('sha256').update(readFileSync(file)).digest('hex'),
    },
  });
  if (!rec) return clean;
  vision.called = true;
  clean = rec.svg;
  // The synthesized <text> nodes flow through the regular proposal path —
  // no special-casing downstream.
  const found = propose(textRuns(clean), pageH).filter((p) => isDim(p.id));
  const check = proposeGeometry(rows, found, clean);
  const ok = new Set(check.lines);
  const kept = found.filter((p) => ok.has(p.id));
  const dropped = found.filter((p) => !ok.has(p.id));
  if (dropped.length) {
    clean = hideIds(clean, dropped.flatMap((p) => p.geom.glyphs.map((g) => g.id).filter(Boolean)));
  }
  writeFileSync(join(dir, 'base.clean.svg'), clean);
  for (const p of kept) { p.unverified = true; props.push(p); }
  vision.dims = kept.length;
  vision.rejected = dropped.length;
  return clean;
}

export async function scaffold(pdf, opts = {}) {
  const file = resolve(pdf);
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const id = opts.id || slug(basename(file).replace(/\.pdf$/i, ''));
  const dir = join(resolve(opts.templatesDir || 'templates'), id);
  mkdirSync(dir, { recursive: true });

  // 1. convert (fallback chain: Inkscape keeps text — needed for binding)
  const raw = join(dir, 'base.svg');
  const conv = convertPdf(file, raw, { converter: opts.converter || 'auto' });
  let base = readFileSync(raw, 'utf8');

  // 1b. merge glyph-split texts (issue #19): Inkscape's PDF import can emit
  // one <text> per character; run-based field patterns need whole strings.
  // Rewrites base.svg BEFORE the query-all so rows match the merged art.
  if (conv.converter === 'inkscape') {
    const g = mergeGlyphTexts(base);
    if (g.merged) { base = g.svg; writeFileSync(raw, base); }
  }

  // 2. hide coincident outline duplicates (Inkscape backend only — it has the text
  //    layer that makes runs findable; pdftocairo output has no <text> to bind)
  let outlines = 0, clean = base, rows = [];
  if (conv.converter === 'inkscape') {
    rows = parseQueryAll(execFileSync(INK, ['--query-all', raw], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    const dup = coincidentOutlineIds(rows);
    outlines = dup.length;
    clean = hideIds(base, dup);
  }
  writeFileSync(join(dir, 'base.clean.svg'), clean);

  // 3. propose bindings
  const runs = textRuns(clean);
  const pageH = Number((clean.match(/<svg[^>]*\bheight="([\d.]+)"/) || [])[1]) || Math.max(...runs.map((r) => r.y), 1);
  const props = propose(runs, pageH);
  // Preserve-by-default re-scaffold (issue #3): if this template already exists,
  // carry the human-tuned parts over — per-param formula/label, hand-made id-bindings
  // (POST /bind) whose ids still exist in the fresh base art, and the params they
  // reference. What is deterministic (outline hiding, value and geometry bindings)
  // is always recomputed from the current art. opts.force restores the wipe.

  // Vision dimension recovery (docs/plans/vision-dimension-recovery.md):
  // when the text layer yielded zero dimension params (outline-only
  // annotations, known case: LSB-2609-007-FHL-R00.pdf), a vision model
  // proposes each dim's value + position; the located outline glyph cluster
  // is replaced by a real <text> node so the machinery below binds it like
  // any other dim. Rejections (px/mm implausible OR no arrowed dimension
  // line) are reported, never silent. Trigger is zero-dims only (v1);
  // opts.llm === false disables the call, opts.llm may inject a fake
  // (tests), and with no key the pass is a no-op (today's behavior).
  const vision = { called: false, dims: 0, rejected: 0 };
  // The gate also requires the Inkscape path: pdftocairo outlines EVERYTHING
  // (title block included), so a pdftocairo conversion has no <text> runs at
  // all — outline synthesis would produce nothing bindable. A zero-dims PDF
  // converted via pdftocairo therefore gets no vision pass (v1, defensible).
  if (conv.converter === 'inkscape' && rows.length && !props.some((p) => isDim(p.id)) && opts.llm !== false) {
    clean = await recoverAndBindVisionDims({ file, dir, rows, clean, pageH, props, vision, llm: opts.llm });
  }
  // Preserve hand-edits across re-scaffolds: if this template already exists, carry
  // the manual per-param fields (formula, label) over to the newly proposed params.
  const prevPath = join(dir, 'template.json');
  let prevById = {}, prevIdBindings = [], prevPartBindings = [];
  if (!opts.force && existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      prevById = Object.fromEntries((prev.params || []).map((p) => [p.id, p]));
      const artIds = svgIds(clean);
      prevIdBindings = (prev.bindings || []).filter(
        (b) => Array.isArray(b.ids) && b.ids.length && !b.geom && b.ids.every((id) => artIds.has(id))
      );
      // Hand-made part bindings (issue #8, ticket #12): a previous geom binding
      // is a carry candidate iff its ids all exist in the fresh art AND its
      // param's value is unchanged (the params id+value rule — dim ids are
      // positional, so a changed value means the art moved). Whether it
      // survives is decided after the geometry pass, against the fresh
      // proposals; its calibration is always re-derived from the fresh art.
      prevPartBindings = (prev.bindings || []).filter(
        (b) => Array.isArray(b.ids) && b.ids.length && b.geom && b.ids.every((id) => artIds.has(id))
          && prevById[b.param]
          && props.some((p) => p.id === b.param && String(prevById[b.param].default) === String(p.value))
      );
      for (const p of props) {
        // match id AND value: dim ids are positional, so the same id can be a
        // different dimension when a re-scaffold finds new dims
        const old = prevById[p.id];
        if (old && String(old.default) === String(p.value)) {
          if (old.formula) p.formula = old.formula;
          if (old.label && old.label !== p.label) p.label = old.label;
        }
      }
    } catch { /* corrupted old template — proceed without preservation */ }
  }
  // LLM-proposed derived formulas (PLAN §1B): which dimensions are structurally
  // derived from which. Geometry-aware (1C.8b): the model also sees each dim's
  // measure axis, text position, and glyph span, so it can propose parallel/
  // offset/sum rules that values alone hide. Manual formulas above always win;
  // opts.llm === false skips the call (tests, offline runs); opts.llm may be a
  // function to inject a fake LLM (tests).
  let llmFormulas = 0;
  if (opts.llm !== false && props.length >= 2) {
    const { proposeFormulas } = await import('./formulas.mjs');
    const withGeom = props.map((p) => {
      const g = geomMeta(p.geom);
      return { id: p.id, label: p.label, value: p.value, ...(g ? { geom: g } : {}) };
    });
    const proposed = await proposeFormulas(withGeom, typeof opts.llm === 'function' ? { call: opts.llm } : {});
    for (const [id, formula] of Object.entries(proposed.formulas)) {
      const p = props.find((x) => x.id === id);
      if (p && !p.formula) { p.formula = formula; llmFormulas++; }
    }
    // Additive literals become named constant params — editable, not buried.
    for (const [cid, val] of Object.entries(proposed.constants)) {
      if (!props.some((p) => p.id === cid)) props.push({ id: cid, label: `Constant (${cid})`, value: String(val), isConst: true });
    }
  }
  // Constants referenced by carried-over (preserved) formulas must survive a
  // re-scaffold even when the LLM is skipped or doesn't re-propose them.
  // Runs on every scaffold; with no prior template (or --force) prevById is empty.
  {
    const refIds = (expr) => (expr.match(/(?<![.\d])\b[a-zA-Z_]\w*\b/g) || []);
    for (const p of props) {
      if (!p.formula) continue;
      for (const ref of refIds(p.formula)) {
        if (props.some((x) => x.id === ref)) continue;
        const old = prevById[ref];
        if (old?.const || old?.isConst) props.push({ id: old.id, label: old.label, value: String(old.default), isConst: true });
      }
    }
  }
  // A preserved id-binding whose param the fresh scaffold didn't propose (a
  // hand-added /bind param) carries its param over, or the binding would dangle.
  const idBoundParams = [];
  for (const b of prevIdBindings) {
    if (props.some((p) => p.id === b.param)) continue;
    const old = prevById[b.param];
    if (old) idBoundParams.push({ id: old.id, label: old.label, value: String(old.default), isConst: !!old.const, idBound: true });
  }
  props.push(...idBoundParams);
  // a preserved hand-made id-binding re-anchors its param by id — it replaces
  // the fresh value binding for that param instead of double-binding it
  const idBound = new Set(prevIdBindings.map((b) => b.param));
  const tpl = {
    id,
    name: props.find((p) => p.id === 'productName')?.value || basename(file),
    source: opts.sourceName || basename(file),
    match: {},
    base: { svg: 'base.clean.svg' },
    params: props.map((p) => ({ id: p.id, label: p.label, type: 'text', default: p.value, ...(p.formula ? { formula: p.formula } : {}), ...(p.isConst ? { const: true } : {}), ...(p.unverified ? { unverified: true } : {}) })),
    bindings: props.filter((p) => !p.isConst && !p.idBound && !idBound.has(p.id)).map((p) => ({ value: p.value, param: p.id, mode: p.mode })),
    sample: makeSample(props),
  };
  // L2 geometry: dim lines (with their arrowheads and text centres) track the value.
  let geomLines = 0;
  let parts = [];
  let calib = {};
  let annotated = new Set();
  let freshGeomIds = new Set();
  let llmParts = { asked: 0, bound: 0, rejected: 0 };
  if (rows.length) {
    const g = proposeGeometry(rows, props, clean);
    tpl.bindings.push(...g.bindings);
    geomLines = g.lines.length;
    parts = g.parts;
    calib = g.calib;
    annotated = g.annotated;
    freshGeomIds = new Set(g.bindings.flatMap((b) => b.ids || []));

    // LLM part proposals (spec #15): for dims whose deterministic proposal
    // left skipped candidates, the model picks which elements the dim
    // measures (spans vs attached) from the SAME candidate pool and guard
    // rails; the engine derives ops and self-calibrates. Quiet no-op without
    // a key or with opts.llm === false; opts.llm may inject a fake (tests).
    if (opts.llm !== false) {
      const eligible = g.recs.filter((r, i) => g.parts[i]?.skipped > 0);
      if (eligible.length) {
        const { proposeLlmParts, mergeLlmParts } = await import('./partsLlm.mjs');
        const lp = await proposeLlmParts({
          file,
          recs: eligible,
          usable: g.usable,
          claimed: g.claimed,
          matrixOf: g.matrixOf,
          ...(typeof opts.llm === 'function' ? { call: opts.llm } : {}),
        });
        if (lp) {
          ({ parts, freshGeomIds } = mergeLlmParts(parts, tpl.bindings, freshGeomIds, lp));
          llmParts = lp.summary;
        }
      }
    }
  }
  // hand-made id-bindings carried over from the prior template (issue #3)
  tpl.bindings.push(...prevIdBindings);
  // hand-made part bindings carried over (ticket #12): kept only when the
  // fresh proposal left their dim untouched — a dim with fresh part proposals
  // is reproduced (auto-proposed bindings are always recomputed, never
  // carried), and so is a dim whose annotations were re-proposed this run:
  // a param in `annotated` was rebuilt from the fresh art, so a previous
  // binding for it (e.g. a half-rate text binding whose glyph ids changed)
  // would duplicate it at a recomputed rate. Exception: an ambiguous dim
  // (0 bound) proposed nothing at all — hand-made part bindings for the dims
  // the scaffold skipped still carry (spec story 18). A carried binding must
  // also have none of its ids fresh-bound elsewhere (an element binds to at
  // most one dimension, spec #8). Membership (ids, param, op incl. about) is
  // kept; anchor and pxPerUnit are re-derived from the fresh art, so stale
  // calibration can never survive a re-scaffold.
  const carriedParts = [];
  const reproduced = new Set(parts.filter((d) => d.bound > 0).map((d) => d.param));
  const skippedAmbiguous = new Set(parts.filter((d) => d.ambiguous && d.bound === 0).map((d) => d.param));
  for (const b of prevPartBindings) {
    const c = calib[b.param];
    if (!c || reproduced.has(b.param) || b.ids.some((id) => freshGeomIds.has(id))) continue;
    if (annotated.has(b.param) && !skippedAmbiguous.has(b.param)) continue;
    const geom = b.geom.op?.startsWith('stretch')
      ? { op: b.geom.op, ...(b.geom.about ? { about: b.geom.about } : {}), anchor: c.v }
      : { op: b.geom.op, anchor: c.v, pxPerUnit: c.s };
    carriedParts.push({ ids: b.ids, param: b.param, geom });
  }
  tpl.bindings.push(...carriedParts);
  writeFileSync(join(dir, 'template.json'), JSON.stringify(tpl, null, 2) + '\n');

  // 4. editor
  const ed = buildEditor(dir, { previewDir: opts.previewDir || join(resolve(opts.templatesDir || 'templates'), '..', 'preview') });

  return { id, dir, outlines, props, llmFormulas, geomLines, parts, preserved: prevIdBindings.length, preservedParts: carriedParts.length, vision, llmParts, editor: ed.out, editorMB: (ed.bytes / 1e6).toFixed(1) };
}

/** Human-readable scaffold summary — the single reporting path for both
 *  `node src/eval/scaffold.mjs` and the documented `ladder scaffold` command,
 *  so a vision rejection can never be silent through one of them. */
export function reportScaffold(r, log = console.log) {
  log(`scaffolded: ${r.id}`);
  log(`  folder    : ${r.dir}`);
  log(`  outlines  : ${r.outlines} duplicate(s) hidden`);
  log(`  proposed  : ${r.props.length} binding(s)`);
  for (const p of r.props) log(`     ${p.id.padEnd(12)} ${p.mode.padEnd(6)} ${JSON.stringify(p.value)}`);
  if (r.geomLines) log(`  geometry  : ${r.geomLines} dimension line(s) track their value`);
  if (r.parts?.length) {
    log(`  parts     : ${r.parts.length} dimension(s) propose part bindings`);
    for (const d of r.parts) {
      const provenance = d.llm ? ` (${d.bound - d.llm} rule, ${d.llm} llm)` : '';
      log(`     ${d.param.padEnd(12)} ${d.ambiguous ? `${d.bound} bound${provenance}, skipped: ambiguous` : `${d.bound} bound${provenance}, ${d.skipped} skipped`}`);
    }
  }
  if (r.llmParts?.asked) log(`  llm parts : ${r.llmParts.asked} dim(s) asked, ${r.llmParts.bound} binding(s) accepted, ${r.llmParts.rejected} id(s) rejected`);
  if (r.preserved) log(`  preserved : ${r.preserved} hand-made id-binding(s) kept`);
  if (r.preservedParts) log(`  preserved : ${r.preservedParts} hand-made part binding(s) kept, calibration re-derived`);
  if (r.vision.called) log(`  vision    : ${r.vision.dims} dim(s) recovered, ${r.vision.rejected} rejected by the plausibility check`);
  log(`  editor    : ${r.editor}  (${r.editorMB} MB)`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('scaffold.mjs')) {
  const pdf = process.argv[2];
  if (!pdf || pdf.startsWith('--')) { console.error('usage: node src/eval/scaffold.mjs <file.pdf> [--force]'); process.exit(1); }
  try {
    const r = await scaffold(pdf, { force: process.argv.includes('--force') });
    reportScaffold(r);
  } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
