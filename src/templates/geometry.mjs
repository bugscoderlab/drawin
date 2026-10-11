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
//   'stretchAxial'          : like stretchX but along the element's OWN
//       axis. Two cases, one contract (length change along the axis, angle
//       preserved, the pinned end stays fixed in user space):
//       (1) the matrix carries rotation (b≠0, #21): scales the whole local
//       x-axis column (a,b) by (value / anchor), translating e,f so the
//       pinned LOCAL end stays fixed: e' = e + a·p₀·(1−ratio), f' = f +
//       b·p₀·(1−ratio), p₀ from the path's local x-extent (the
//       localExtent()/about machinery: "min" pins the local-origin end, p₀=0;
//       "max" pins the far end).
//       (2) the matrix is axis-aligned but the element's axis lives in its
//       path DATA (b=0, diagonal d — the #20 finding on converted art, #23):
//       the local axis u is the unit vector of the dominant straight run in
//       d (localAxis()), and the op applies the linear map P = I +
//       (ratio−1)·u·uᵀ to EVERY coordinate pair in d — anchors and control
//       points alike, so bends and curves deform exactly. The pinned end is
//       the min/max projection end per about (p₀ scalar; "max" = hi end); the
//       translation fix e,f += M·p₀·u − M·P·(p₀·u) = (1−ratio)·p₀·M·u keeps
//       the pinned USER point fixed. A straight d along local x (u = ±x̂)
//       reduces to case (1) — the same map as scaling the (a,b) column — so
//       that case keeps the matrix-level rewrite (byte-identical to stretchX,
//       proved by the byte-identity tests). Unusable input (no straight
//       segment, degenerate lengths, or A arcs a non-uniform map cannot
//       deform exactly) is reported, never thrown.
//   'shiftAxial'            : like shiftX but translates along the element's
//       own local axis unit direction in USER space by (value − anchor) *
//       pxPerUnit. Matrix-rotated: (a,b)/|(a,b)| as today (#21); axis-aligned
//       matrix with diagonal d: the data axis through the matrix, u_user =
//       M·u/|M·u| (#23) — the d=−1 flip of converted art flips the direction
//       exactly as the rendered geometry demands. For b=0 + straight-x d this
//       equals (a,0)/|a| — byte-identical to shiftX/shiftY. Missing/unusable
//       d or a degenerate zero-length axis is reported, never thrown.
//
// Self-calibrating: all numbers come from the drawing itself, so it works on
// art drawn at any scale (shop drawings are frequently not uniformly scaled).
// Elements are located by id; missing ids / non-numeric values / unsupported
// transforms are reported, never thrown (resilience rule).

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
};

// 7 decimals: Inkscape's own output carries up to 7 (e.g. 1.3333333) —
// fewer silently reformats (and slightly detunes) every rewritten element.
const fmt = (n) => String(Number(n.toFixed(7)));

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
 *  { lo, hi } or null when the element has no d / an unsupported command.
 *  Exported for the proposal stage (spec #20): an axial part binding needs a
 *  usable local x extent for its pinned about end. */
export function localExtent(tag, axis) {
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

/** Recover an element's local axis from its path DATA (the #20 finding,
 *  ticket #23): on converted art the rotation is baked into d — every path
 *  carries an axis-aligned scale/flip matrix — so the axis the element is
 *  DRAWN along is the unit vector of the dominant straight run in d: a
 *  maximal sequence of collinear straight segments (L/H/V and Z-closures;
 *  curves and pen lifts break a run). Returns:
 *    l    local unit axis [x,y], start→end of the longest run
 *    u    the same axis through `matrix` (parseMatrix result; user space,
 *         unit) — null when the matrix collapses the axis to zero length
 *    lo/hi   projection extent of every anchor point onto l (control points
 *         do not count — localExtent semantics)
 *    pLo/pHi the anchor points achieving lo/hi (local coords)
 *    pts  every anchor point (local coords), for measured-axis projections
 *    bestLen/secondLen  the two longest run lengths — the caller's gate for
 *         "is this actually an axial member" (a blob whose runs compete,
 *         like a right-triangle bolt outline, has no meaningful axis)
 *    arc  true when d carries A arcs (a non-uniform linear map cannot
 *         deform those exactly — the d-level op reports them)
 *  Returns null when d has no usable straight segment (curves-only,
 *  degenerate zero-length runs, missing/unsupported d). Shared by the
 *  engine (the d-level axial ops) and the proposal stage (classifying
 *  data-diagonal candidates) so both sides recover the axis ONE way. */
export function localAxis(matrix, d) {
  const t = String(d || '').match(/[a-zA-Z]|-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g);
  if (!t) return null;
  let i = 0, cmd = '', x = 0, y = 0, ox = 0, oy = 0, arc = false;
  const pts = [], runs = [];
  let run = null;
  const read = () => {
    const n = parseFloat(t[i++]);
    return Number.isNaN(n) ? 0 : n;
  };
  const flush = () => { if (run) { runs.push(run); run = null; } };
  const point = (nx, ny) => {
    pts.push([nx, ny]);
    x = nx; y = ny;
  };
  const seg = (nx, ny) => {          // straight ink from (x,y) to (nx,ny)
    const vx = nx - x, vy = ny - y;
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      if (run) {
        const rx = run.x1 - run.x0, ry = run.y1 - run.y0;
        const rl = Math.hypot(rx, ry);
        const cross = Math.abs(rx * vy - ry * vx);
        if (cross <= 1e-9 * rl * len && rx * vx + ry * vy > 0) { run.x1 = nx; run.y1 = ny; }
        else { flush(); run = { x0: x, y0: y, x1: nx, y1: ny }; }
      } else run = { x0: x, y0: y, x1: nx, y1: ny };
    }
    point(nx, ny);
  };
  const curve = (n) => {             // n params; only the endpoint anchors
    flush();
    const rel = cmd >= 'a' && cmd <= 'z';
    const px = rel ? x : 0, py = rel ? y : 0;
    const p = [];
    for (let j = 0; j < n; j++) p.push(read());
    point(px + p[n - 2], py + p[n - 1]);
  };
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i])) {
      cmd = t[i++];
      if (cmd === 'Z' || cmd === 'z') { seg(ox, oy); continue; }
    }
    const rel = cmd >= 'a' && cmd <= 'z';
    const px = rel ? x : 0, py = rel ? y : 0;
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l') {
      if (cmd === 'M' || cmd === 'm') { flush(); }
      let relP = cmd === 'm' || cmd === 'l';
      do {
        const qx = relP ? x : 0, qy = relP ? y : 0;
        seg(qx + read(), qy + read());
        if (cmd === 'M' || cmd === 'm') { ox = x; oy = y; cmd = cmd === 'M' ? 'L' : 'l'; relP = cmd === 'l'; }
      } while (i < t.length && !/[a-zA-Z]/.test(t[i]));
    } else if (cmd === 'H' || cmd === 'h') {
      seg(px + read(), y);
    } else if (cmd === 'V' || cmd === 'v') {
      seg(x, py + read());
    } else if (cmd === 'C' || cmd === 'c') { curve(6); }
    else if (cmd === 'S' || cmd === 's' || cmd === 'Q' || cmd === 'q') { curve(4); }
    else if (cmd === 'T' || cmd === 't') { curve(2); }
    else if (cmd === 'A' || cmd === 'a') { arc = true; curve(7); }
    else return null; // unknown or missing command — no reliable axis
  }
  flush();
  if (!runs.length) return null;
  let best = runs[0], bestLen = -1, secondLen = 0;
  for (const r of runs) {
    const l = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
    if (l > bestLen) { secondLen = bestLen > 0 ? bestLen : 0; best = r; bestLen = l; }
    else if (l > secondLen) secondLen = l;
  }
  if (bestLen <= 0) return null;
  const l = [(best.x1 - best.x0) / bestLen, (best.y1 - best.y0) / bestLen];
  let lo = Infinity, hi = -Infinity, pLo = null, pHi = null;
  for (const p of pts) {
    const s = p[0] * l[0] + p[1] * l[1];
    if (s < lo) { lo = s; pLo = p; }
    if (s > hi) { hi = s; pHi = p; }
  }
  let u = l;
  if (matrix) {
    const ux = matrix.a * l[0] + matrix.c * l[1], uy = matrix.b * l[0] + matrix.d * l[1];
    const ul = Math.hypot(ux, uy);
    u = ul > 0 ? [ux / ul, uy / ul] : null;
  }
  return { l, u, lo, hi, pLo, pHi, pts, arc, bestLen, secondLen };
}

/** Apply the linear map p' = p + k·(p·l)·l to every coordinate pair of d —
 *  anchors and control points alike (the map is linear, so curves deform
 *  exactly; only A arcs cannot, and are refused with null). H/V collapse to
 *  L with the full mapped endpoint, since the map mixes x and y. Absolute
 *  pairs map as points, relative pairs as deltas — both exact by linearity.
 *  Returns the rewritten d or null. */
function mapPathData(d, k, l) {
  const t = String(d || '').match(/[a-zA-Z]|-?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g);
  if (!t) return null;
  const [ux, uy] = l;
  const mapN = (x, y) => {
    const s = k * (x * ux + y * uy);
    return [x + s * ux, y + s * uy];
  };
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, ox = 0, oy = 0;
  const read = () => {
    const n = parseFloat(t[i++]);
    return Number.isNaN(n) ? 0 : n;
  };
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i])) {
      cmd = t[i++];
      if (cmd === 'Z' || cmd === 'z') { out.push('Z'); x = ox; y = oy; continue; }
    }
    const rel = cmd >= 'a' && cmd <= 'z';
    const px = rel ? x : 0, py = rel ? y : 0;
    const emit = (c, pairs) => out.push(`${c} ${pairs.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}`);
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l' || cmd === 'T' || cmd === 't') {
      const nx = px + read(), ny = py + read();
      emit(cmd, [mapN(nx, ny)]);
      x = nx; y = ny;
      if (cmd === 'M') { ox = x; oy = y; cmd = 'L'; }
      else if (cmd === 'm') { ox = x; oy = y; cmd = 'l'; }
    } else if (cmd === 'H' || cmd === 'h') {
      const nx = px + read(), ny = y;
      emit('L', [mapN(nx, ny)]);
      x = nx; y = ny;
    } else if (cmd === 'V' || cmd === 'v') {
      const nx = x, ny = py + read();
      emit('L', [mapN(nx, ny)]);
      x = nx; y = ny;
    } else if (cmd === 'C' || cmd === 'c') {
      const pairs = [];
      for (let j = 0; j < 3; j++) {
        const nx = px + read(), ny = py + read();
        pairs.push(mapN(nx, ny));
        if (j === 2) { x = nx; y = ny; }
      }
      emit('C', pairs);
    } else if (cmd === 'S' || cmd === 's' || cmd === 'Q' || cmd === 'q') {
      const pairs = [];
      for (let j = 0; j < 2; j++) {
        const nx = px + read(), ny = py + read();
        pairs.push(mapN(nx, ny));
        if (j === 1) { x = nx; y = ny; }
      }
      emit(cmd.toUpperCase(), pairs);
    } else if (cmd === 'A' || cmd === 'a') {
      return null; // an arc's radii/rotation cannot be deformed by a linear map
    } else return null;
  }
  return out.length ? out.join(' ') : null;
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
    if (!['stretchX', 'stretchY', 'shiftX', 'shiftY', 'stretchAxial', 'shiftAxial'].includes(op)) {
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
      else if (op === 'stretchAxial') {
        // Two cases, one contract — the pinned end stays fixed in user space
        // (header docs): rotated matrix -> scale the (a,b) column (#21);
        // axis-aligned matrix -> the element's axis lives in its path data,
        // apply the linear map at the d level (#23).
        const el = elementById(out, id);
        const cur = el && /\btransform="[^"]*"/.test(el.tag) ? el.tag.match(/\btransform="([^"]*)"/)[1] : null;
        const mm = cur ? parseMatrix(cur) : null;
        if (cur && !mm) { ok = false; reasons.push(`${id}: unsupported transform`); continue; }
        const m0 = mm || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        if (m0.b !== 0) {
          // #21: scale the whole local x-axis column about the pinned LOCAL
          // end (about "min" -> p0 = 0, the local origin; "max" -> far end
          // of the local x-extent).
          let p0 = 0;
          if (about === 'max') {
            const ext = el && localExtent(el.tag, 'x');
            if (!el || !ext) { ok = false; reasons.push(`${id}: ${el ? 'no local extent' : 'id not found'}`); continue; }
            p0 = Math.abs(ext.lo) > Math.abs(ext.hi) ? ext.lo : ext.hi;
          }
          r = patchTransform(out, id, (m) => ({ ...m, a: m.a * ratio, b: m.b * ratio, e: m.e + m.a * p0 * (1 - ratio), f: m.f + m.b * p0 * (1 - ratio) }));
        } else {
          // #23: axis-aligned matrix — recover the axis from path data.
          const dm = el && el.tag.match(/\bd="([^"]*)"/);
          const ax = dm && localAxis(m0, dm[1]);
          if (!el || !ax) { ok = false; reasons.push(`${id}: ${el ? 'no local extent' : 'id not found'}`); continue; }
          if (Math.abs(ax.l[1]) <= 1e-9) {
            // Straight d along local x: the d-level map equals scaling the
            // (a,b) column — keep the matrix-level rewrite so b=0 renders
            // byte-identically to stretchX (the byte-identity tests).
            let p0 = 0;
            if (about === 'max') {
              const ext = localExtent(el.tag, 'x');
              if (!ext) { ok = false; reasons.push(`${id}: no local extent`); continue; }
              p0 = Math.abs(ext.lo) > Math.abs(ext.hi) ? ext.lo : ext.hi;
            }
            r = patchTransform(out, id, (m) => ({ ...m, a: m.a * ratio, b: m.b * ratio, e: m.e + m.a * p0 * (1 - ratio), f: m.f + m.b * p0 * (1 - ratio) }));
          } else {
            // d level: P = I + (ratio-1)·u·uᵀ on every coordinate pair, then
            // the translation fix (1-ratio)·p0·M·u pins the about end.
            if (ax.arc) { ok = false; reasons.push(`${id}: arc segments cannot be stretched exactly`); continue; }
            const nd = mapPathData(dm[1], ratio - 1, ax.l);
            if (!nd) { ok = false; reasons.push(`${id}: unsupported path data`); continue; }
            const p0 = about === 'max' ? ax.hi : ax.lo;
            const fix = (1 - ratio) * p0;
            const de = fix * (m0.a * ax.l[0] + m0.c * ax.l[1]);
            const df = fix * (m0.b * ax.l[0] + m0.d * ax.l[1]);
            let tag = el.tag.replace(/\bd="[^"]*"/, `d="${nd}"`);
            out = out.slice(0, el.index) + tag + out.slice(el.index + el.length);
            r = patchTransform(out, id, (m) => ({ ...m, e: m.e + de, f: m.f + df }));
          }
        }
      }
      else if (op === 'shiftAxial') {
        // Translate along the element's own axis in user space: matrix-rotated
        // -> the (a,b) column (#21); axis-aligned matrix -> the data axis
        // through the matrix, M·u/|M·u| (#23).
        const el = elementById(out, id);
        const cur = el && /\btransform="[^"]*"/.test(el.tag) ? el.tag.match(/\btransform="([^"]*)"/)[1] : null;
        const mm = cur ? parseMatrix(cur) : null;
        if (cur && !mm) { ok = false; reasons.push(`${id}: unsupported transform`); continue; }
        const m0 = mm || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        let dir;
        if (m0.b !== 0) {
          const len = Math.hypot(m0.a, m0.b);
          if (len === 0) { ok = false; reasons.push(`${id}: degenerate axis`); continue; }
          dir = [m0.a / len, m0.b / len];
        } else {
          const dm = el && el.tag.match(/\bd="([^"]*)"/);
          const ax = dm && localAxis(m0, dm[1]);
          if (!el) { ok = false; reasons.push(`${id}: id not found`); continue; }
          if (!ax || !ax.u) { ok = false; reasons.push(`${id}: ${ax ? 'degenerate axis' : 'no straight segment'}`); continue; }
          dir = ax.u;
        }
        const d = (value - anchor) * pxPerUnit;
        r = patchTransform(out, id, (m) => ({ ...m, e: m.e + dir[0] * d, f: m.f + dir[1] * d }));
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
