// L2 geometry bindings: move/resize bound elements so dimension lines track
// the parameter value, not just the text (PLAN §4a "L2 — geometry").
//
//   applyGeometry(svg, bindings, params) -> { svg, report }
//
// A geometry binding: { ids, param, geom: { op, anchor, about?, pxPerUnit? } }
//   'stretchX' | 'stretchY' : scale the element's transform matrix by
//       (value / anchor), so its extent follows the value. about: "min" | "max"
//       (optional, default "min") names which end of the element's local
//       extent stays pinned: "min" pins the local-origin end — today's
//       behaviour; "max" pins the far end of the drawn extent (the endpoint
//       away from the local origin), so the origin end tracks the value. This
//       is how right-anchored part geometry stretches: the 004 cap-bar shape
//       has its local origin at the moving rail and its path extending
//       negative, so scaling about the local origin would grow it the wrong
//       way; about: "max" holds the far (datum) end while the rail end tracks.
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

/** Local extent of an element along one axis ('x' | 'y'), parsed from its
 *  d attribute and tracked over path endpoints (curve control points do not
 *  count — exact for the line-based art this engine binds). Returns
 *  { lo, hi } or null when the element has no d / an unsupported command. */
function localExtent(tag, axis) {
  const dm = tag.match(/\bd="([^"]*)"/);
  if (!dm) return null;
  const t = dm[1].match(/[a-zA-Z]|-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, ox = 0, oy = 0, lo = 0, hi = 0, started = false;
  const read = () => {
    const n = parseFloat(t[i++]);
    return Number.isNaN(n) ? 0 : n;
  };
  const mark = () => {
    const v = axis === 'x' ? x : y;
    if (!started) { lo = hi = v; started = true; }
    else if (v < lo) lo = v;
    else if (v > hi) hi = v;
  };
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i])) {
      cmd = t[i++];
      if (cmd === 'Z' || cmd === 'z') { x = ox; y = oy; mark(); continue; }
    }
    const rel = cmd >= 'a' && cmd <= 'z';
    const px = rel ? x : 0, py = rel ? y : 0;
    const up = (nx, ny) => { x = px + nx; y = py + ny; mark(); };
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l') up(read(), read());
    else if (cmd === 'H' || cmd === 'h') up(read(), 0);
    else if (cmd === 'V' || cmd === 'v') up(0, read());
    else if (cmd === 'C' || cmd === 'c') { const p = [read(), read(), read(), read(), read(), read()]; up(p[4], p[5]); }
    else if (cmd === 'S' || cmd === 's' || cmd === 'Q' || cmd === 'q') { const p = [read(), read(), read(), read()]; up(p[2], p[3]); }
    else if (cmd === 'T' || cmd === 't') up(read(), read());
    else if (cmd === 'A' || cmd === 'a') { const p = [read(), read(), read(), read(), read(), read(), read()]; up(p[5], p[6]); }
    else return null; // unknown or missing command — no reliable extent
  }
  return started ? { lo, hi } : null;
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
    const about = b.geom?.about;
    if (about !== undefined && about !== 'min' && about !== 'max') {
      report.push({ ...b, ok: false, reason: `unknown about "${about}"` });
      continue;
    }
    const ratio = value / anchor;
    const pxPerUnit = num(b.geom?.pxPerUnit) ?? 0;
    let ok = true;
    const reasons = [];
    for (const id of b.ids || []) {
      let r;
      if (about === 'max' && (op === 'stretchX' || op === 'stretchY')) {
        // Pin the far end of the local extent: scaling the near end by the
        // ratio must leave the far end's user position (a*p0 + e) unchanged.
        const el = elementById(out, id);
        const ext = el && localExtent(el.tag, op === 'stretchX' ? 'x' : 'y');
        if (!el || !ext) { ok = false; reasons.push(`${id}: ${el ? 'no local extent' : 'id not found'}`); continue; }
        const p0 = Math.abs(ext.lo) > Math.abs(ext.hi) ? ext.lo : ext.hi;
        if (op === 'stretchX') r = patchTransform(out, id, (m) => ({ ...m, a: m.a * ratio, e: m.e + m.a * p0 * (1 - ratio) }));
        else r = patchTransform(out, id, (m) => ({ ...m, d: m.d * ratio, f: m.f + m.d * p0 * (1 - ratio) }));
      }
      else if (op === 'stretchX') r = patchTransform(out, id, (m) => ({ ...m, a: m.a * ratio }));
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
