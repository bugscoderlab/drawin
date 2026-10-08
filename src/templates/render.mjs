// L1/L2 template renderer: bind, don't redraw.
// Loads a converted SVG and replaces the text of nodes bound to parameters,
// then applies L2 geometry bindings so dimension lines track the value.
//
//   renderTemplate(baseSvg, bindings, params) -> { svg, report }
//
// A binding: { value, param, mode }
//   value : the text currently in the drawing (the "anchor")
//   param : the parameter name to substitute
//   mode  : 'text' (single run) | 'group' (consecutive runs, e.g. per-glyph numbers)
// A geometry binding: { ids, param, geom: { op, anchor, pxPerUnit? } } — see
// geometry.mjs; applied after the text edits, located by element id.

const TEXT_RE = /<text\b[^>]*>[\s\S]*?<\/text>/g;

export function textRuns(svg) {
  const runs = [];
  for (const m of svg.matchAll(TEXT_RE)) {
    const raw = m[0];
    const open = raw.match(/^<text\b[^>]*>/)[0];
    const inner = raw.slice(open.length, raw.length - '</text>'.length);
    const tagged = [...inner.matchAll(/>([^<]*)</g)].map((x) => x[1]);
    const data = tagged.length ? tagged : [inner]; // bare <text>value</text> (core renderer) or <tspan> runs
    const { x, y } = xy(open);
    const mm = open.match(/matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)/);
    const dir = mm ? { a: +mm[1], b: +mm[2] } : { a: 1, b: 0 }; // local x-axis = text advance
    const idm = open.match(/\bid="([^"]+)"/);
    runs.push({ id: idm ? idm[1] : null, start: m.index, end: m.index + raw.length, open, inner, data, text: unesc(data.join('')), x, y, dir });
  }
  return runs;
}

/** Absolute position: prefer the text element's transform matrix, else its x/y. */
function xy(open) {
  const tr = open.match(/matrix\(([-\d.eE, ]+)\)/);
  if (tr) { const p = tr[1].split(/[ ,]+/).map(Number); return { x: p[4] ?? 0, y: p[5] ?? 0 }; }
  const x = open.match(/\bx="(-?[\d.]+)"/), y = open.match(/\by="(-?[\d.]+)"/);
  if (x && y) return { x: +x[1], y: +y[1] };
  return { x: 0, y: 0 };
}

const norm = (s) => String(s).replace(/\s+/g, '');

import { applyGeometry } from './geometry.mjs';

/** Runs partitioned by text direction and sorted into reading order. */
export function orderedLists(runs) {
  const H = [], Vdn = [], Vup = [];
  for (const r of runs) {
    const vertical = Math.abs(r.dir.b) > Math.abs(r.dir.a);
    if (!vertical) H.push(r);
    else if (r.dir.b < 0) Vdn.push(r);   // advances -y → reads bottom-to-top
    else Vup.push(r);
  }
  H.sort((p, q) => (p.y - q.y) || (p.x - q.x));      // left-to-right per line
  Vdn.sort((p, q) => (p.x - q.x) || (q.y - p.y));    // bottom-to-top per column
  Vup.sort((p, q) => (p.x - q.x) || (p.y - q.y));    // top-to-bottom per column
  return [H, Vdn, Vup];
}
const unesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function findRun(runs, value, mode) {
  const target = norm(value);
  if (mode === 'text') return runs.filter((r) => norm(r.text) === target);
  // group: consecutive runs in reading order (handles rotated / per-glyph text).
  for (const list of orderedLists(runs)) {
    for (let i = 0; i < list.length; i++) {
      let acc = '';
      for (let j = i; j < list.length; j++) {
        acc += norm(list[j].text);
        if (acc === target) return list.slice(i, j + 1);
        if (acc.length >= target.length) break;
      }
    }
  }
  return [];
}

function setData(run, values) {
  let k = 0;
  const inner = run.inner.replace(/>([^<]*)</g, (_m, _d) => `>${values[k++] ?? ''}<`);
  return run.open + inner + '</text>';
}

/** Apply bindings to the base SVG. `params` maps param -> new value. */
export function renderTemplate(baseSvg, bindings, params) {
  const runs = textRuns(baseSvg);
  const edits = [];           // { start, end, html }
  const report = [];
  for (const b of bindings) {
    if (b.geom) continue;     // geometry bindings run after the text edits
    const next = params[b.param];
    if (next === undefined) { report.push({ ...b, ok: false, reason: 'no value' }); continue; }
    let group = [];
    if (b.ids && b.ids.length) {
      // anchored by element id — stable across edits
      group = runs.filter((r) => r.id && b.ids.includes(r.id));
      if (!group.length) { report.push({ ...b, ok: false, reason: 'ids not found' }); continue; }
    } else {
      if (String(next) === String(b.value)) { report.push({ ...b, ok: true, runs: 0, unchanged: true }); continue; }
      group = findRun(runs, b.value, b.mode || 'text');
      if (!group.length) { report.push({ ...b, ok: false, reason: 'anchor not found' }); continue; }
    }
    group.forEach((r, i) => edits.push({ start: r.start, end: r.end, html: setData(r, [i === 0 ? esc(next) : '']) }));
    report.push({ ...b, ok: true, runs: group.length, from: b.value ?? b.ids, to: String(next) });
  }
  edits.sort((a, b) => b.start - a.start); // apply back-to-front
  let svg = baseSvg;
  for (const e of edits) svg = svg.slice(0, e.start) + e.html + svg.slice(e.end);

  const geoms = bindings.filter((b) => b.geom);
  if (geoms.length) {
    const g = applyGeometry(svg, geoms, params);
    svg = g.svg;
    report.push(...g.report);
  }
  return { svg, report };
}

/**
 * Resolve a params schema + raw input values into the effective value map.
 * A param with a `formula` (e.g. "footprint + 2*guard") is computed from other
 * params by id (numbers only), so editing one value recalculates its dependents.
 */
export function resolveParams(params, values = {}) {
  const scope = {}, out = {};
  for (const p of params) {
    const raw = values[p.id] !== undefined ? values[p.id] : p.default;
    const n = parseFloat(String(raw).replace(/,/g, ''));
    scope[p.id] = Number.isNaN(n) ? 0 : n;
    out[p.id] = raw;
  }
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const p of params) {
      if (!p.formula) continue;
      try {
        const n = Function(...Object.keys(scope), `return (${p.formula});`)(...Object.values(scope));
        const s = String(n);
        if (out[p.id] !== s) { out[p.id] = s; changed = true; }
        scope[p.id] = n;
      } catch { /* leave as-is */ }
    }
    if (!changed) break;
  }
  return out;
}
