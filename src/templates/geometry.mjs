// L2 geometry bindings: move/resize bound elements so dimension lines track
// the parameter value, not just the text (PLAN §4a "L2 — geometry").
//
//   applyGeometry(svg, bindings, params) -> { svg, report }
//
// A geometry binding: { ids, param, geom: { op, anchor, pxPerUnit? } }
//   'stretchX' | 'stretchY' : scale the element's transform matrix about its
//       local origin by (value / anchor), so its extent follows the value.
//       This is how a dimension line grows: in converted art the line path is
//       local "M 0,0 H L" with a matrix whose translation sits on the datum
//       end, so scaling stretches the line away from the datum.
//   'shiftX' | 'shiftY'     : translate the element by (value - anchor) *
//       pxPerUnit user units. pxPerUnit is the drawing's own px-per-mm for
//       this measure (line extent / anchor): full amount moves a far-end
//       arrowhead with the line; half re-centres the dimension text group.
//
// Self-calibrating: all numbers come from the drawing itself, so it works on
// art drawn at any scale (shop drawings are frequently not uniformly scaled).
// Elements are located by id; missing ids / non-numeric values / unsupported
// transforms are reported, never thrown (resilience rule).

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
};

const fmt = (n) => String(Number(n.toFixed(5)));

export function parseMatrix(transform) {
  const m = String(transform || '').match(/matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)/);
  return m ? { a: +m[1], b: +m[2], c: +m[3], d: +m[4], e: +m[5], f: +m[6] } : null;
}

const matrixStr = ({ a, b, c, d, e, f }) => `matrix(${fmt(a)},${fmt(b)},${fmt(c)},${fmt(d)},${fmt(e)},${fmt(f)})`;

/** Locate an element's start tag by id. Returns { tag, index, length } or null. */
function elementById(svg, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = svg.match(new RegExp(`<[a-zA-Z][^>]*?\\bid="${esc}"[^>]*>`, ''));
  if (!m) return null;
  // ensure the match is an element START tag (id= can't appear in end tags)
  return { tag: m[0], index: m.index, length: m[0].length };
}

/** Patch the transform attribute of one element occurrence. Returns new svg or null. */
function patchTransform(svg, id, patch) {
  const el = elementById(svg, id);
  if (!el) return { svg, error: 'id not found' };
  let tag = el.tag;
  const had = /\btransform="[^"]*"/.test(tag);
  const cur = had ? tag.match(/\btransform="([^"]*)"/)[1] : null;
  const m = cur ? parseMatrix(cur) : null;
  if (cur && !m) return { svg, error: 'unsupported transform' };
  const next = patch(m || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  if (!next) return { svg, error: 'unsupported transform' };
  tag = had ? tag.replace(/\btransform="[^"]*"/, `transform="${matrixStr(next)}"`)
            : tag.replace(/(\bid="[^"]*")/, `$1 transform="${matrixStr(next)}"`);
  return { svg: svg.slice(0, el.index) + tag + svg.slice(el.index + el.length) };
}

/** Apply all geometry bindings. `params` maps param -> new value (strings ok). */
export function applyGeometry(svg, bindings, params) {
  const report = [];
  let out = svg;
  for (const b of bindings) {
    const v = params[b.param];
    const value = num(v);
    const anchor = num(b.geom?.anchor);
    const op = b.geom?.op;
    if (value === null || anchor === null || anchor <= 0 || value <= 0) {
      report.push({ ...b, ok: false, reason: 'not numeric' });
      continue;
    }
    if (!['stretchX', 'stretchY', 'shiftX', 'shiftY'].includes(op)) {
      report.push({ ...b, ok: false, reason: `unknown op "${op}"` });
      continue;
    }
    const ratio = value / anchor;
    const pxPerUnit = num(b.geom?.pxPerUnit) ?? 0;
    let ok = true;
    const reasons = [];
    for (const id of b.ids || []) {
      let r;
      if (op === 'stretchX') r = patchTransform(out, id, (m) => ({ ...m, a: m.a * ratio }));
      else if (op === 'stretchY') r = patchTransform(out, id, (m) => ({ ...m, d: m.d * ratio }));
      else if (op === 'shiftX') r = patchTransform(out, id, (m) => ({ ...m, e: m.e + (value - anchor) * pxPerUnit }));
      else r = patchTransform(out, id, (m) => ({ ...m, f: m.f + (value - anchor) * pxPerUnit }));
      if (r.error) { ok = false; reasons.push(`${id}: ${r.error}`); }
      else out = r.svg;
    }
    report.push({ ...b, ok, ratio: fmt(ratio), ...(ok ? {} : { reason: reasons.join('; ') }) });
  }
  return { svg: out, report };
}
