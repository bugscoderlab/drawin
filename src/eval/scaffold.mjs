// Scaffold a template (and its editor HTML) from any PDF — the missing "upload PDF" hop.
//
//   node src/eval/scaffold.mjs "LSB-2607-003-RHC-R00.pdf"
//
// Steps: convert (Inkscape) -> hide outline duplicates -> propose bindings from the
// drawing's own text -> write templates/<id>/template.json -> build the editor HTML.
// Conversion is native (Inkscape/poppler), which is why this lives in the CLI.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { textRuns, findRun, orderedLists } from '../templates/render.mjs';
import { parseQueryAll, coincidentOutlineIds, hideIds } from '../templates/authoring.mjs';
import { buildEditor } from './makeEditor.mjs';
import { convertPdf } from '../convert/convert.mjs';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape';   // container/VPS: resolve via PATH (still needed for --query-all)
const norm = (s) => String(s).replace(/\s+/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
  add('productName', 'Title', texts.filter((t) => /^[A-Z][A-Z0-9 ,&()/.-]{15,}$/.test(t)).sort((a, b) => b.length - a.length)[0]);
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
 *   proposeGeometry(rows, props, svg) -> { bindings, lines: [paramId] }
 */
export function proposeGeometry(rows, props, svg = '') {
  const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isNaN(n) ? null : n; };
  const cleanIds = svg ? new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])) : null;
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

  const bindings = [], lines = [];
  const claimed = new Set();
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

    const axis = vertical ? 'Y' : 'X';
    const out = [{ ids: [line.id], param: p.id, geom: { op: `stretch${axis}`, anchor: v } }];
    // The matrix translation sits on the datum (fixed) end of the line; the
    // arrowhead at the OTHER end moves with the stretched line.
    const m = transformOf(line.id)?.match(/matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)/);
    if (m) {
      const oe = +m[5], of = +m[6];
      const ends = endsOf(line, vertical);
      const dFix = Math.min(Math.hypot(ends[0].x - oe, ends[0].y - of), Math.hypot(ends[1].x - oe, ends[1].y - of));
      const moving = ends.find((e) => Math.hypot(e.x - oe, e.y - of) > dFix + 1);
      const arrow = moving && arrowAt(moving);
      if (arrow) out.push({ ids: [arrow.id], param: p.id, geom: { op: `shift${axis}`, anchor: v, pxPerUnit: s } });
    }
    out.push({ ids: g.glyphs.map((x) => x.id).filter(Boolean), param: p.id, geom: { op: `shift${axis}`, anchor: v, pxPerUnit: s / 2 } });
    bindings.push(...out);
    lines.push(p.id);
  }
  return { bindings, lines };
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

export async function scaffold(pdf, opts = {}) {
  const file = resolve(pdf);
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const id = opts.id || slug(basename(file).replace(/\.pdf$/i, ''));
  const dir = join(resolve(opts.templatesDir || 'templates'), id);
  mkdirSync(dir, { recursive: true });

  // 1. convert (fallback chain: Inkscape keeps text — needed for binding)
  const raw = join(dir, 'base.svg');
  const conv = convertPdf(file, raw, { converter: opts.converter || 'auto' });
  const base = readFileSync(raw, 'utf8');

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
  // Preserve hand-edits across re-scaffolds: if this template already exists, carry
  // the manual per-param fields (formula, label) over to the newly proposed params.
  const prevPath = join(dir, 'template.json');
  let prevById = {};
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      prevById = Object.fromEntries((prev.params || []).map((p) => [p.id, p]));
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
    // Constants referenced by carried-over (preserved) formulas must survive
    // a re-scaffold even when the LLM doesn't re-propose them.
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
  const tpl = {
    id,
    name: props.find((p) => p.id === 'productName')?.value || basename(file),
    source: opts.sourceName || basename(file),
    match: {},
    base: { svg: 'base.clean.svg' },
    params: props.map((p) => ({ id: p.id, label: p.label, type: 'text', default: p.value, ...(p.formula ? { formula: p.formula } : {}), ...(p.isConst ? { const: true } : {}) })),
    bindings: props.filter((p) => !p.isConst).map((p) => ({ value: p.value, param: p.id, mode: p.mode })),
    sample: makeSample(props),
  };
  // L2 geometry: dim lines (with their arrowheads and text centres) track the value.
  let geomLines = 0;
  if (rows.length) {
    const g = proposeGeometry(rows, props, clean);
    tpl.bindings.push(...g.bindings);
    geomLines = g.lines.length;
  }
  writeFileSync(join(dir, 'template.json'), JSON.stringify(tpl, null, 2) + '\n');

  // 4. editor
  const ed = buildEditor(dir, { previewDir: opts.previewDir || join(resolve(opts.templatesDir || 'templates'), '..', 'preview') });

  return { id, dir, outlines, props, llmFormulas, geomLines, editor: ed.out, editorMB: (ed.bytes / 1e6).toFixed(1) };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('scaffold.mjs')) {
  const pdf = process.argv[2];
  if (!pdf) { console.error('usage: node src/eval/scaffold.mjs <file.pdf>'); process.exit(1); }
  try {
    const r = await scaffold(pdf);
    console.log(`scaffolded: ${r.id}`);
    console.log(`  folder    : ${r.dir}`);
    console.log(`  outlines  : ${r.outlines} duplicate(s) hidden`);
    console.log(`  proposed  : ${r.props.length} binding(s)`);
    for (const p of r.props) console.log(`     ${p.id.padEnd(12)} ${p.mode.padEnd(6)} ${JSON.stringify(p.value)}`);
    if (r.geomLines) console.log(`  geometry  : ${r.geomLines} dimension line(s) track their value`);
    console.log(`  editor    : ${r.editor}  (${r.editorMB} MB)`);
  } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
