// Template authoring helpers.
// Key job so far: detect outline duplicates. A converted SVG can carry a value
// TWICE — editable <text> plus a coincident outlined <path>. Substituting the
// text then leaves a ghost, so the authoring step hides the outline copy.

/** Parse `inkscape --query-all` output: "id,x,y,w,h" per line. */
export function parseQueryAll(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^([^,]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/);
    if (m) rows.push({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return rows;
}

/** Ids present in an SVG document (`id="..."` attributes) — the one place the
 *  id-extraction regex lives; scaffold and serve both validate bindings
 *  against this. */
export function svgIds(svg) {
  return new Set([...String(svg).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** Ids of <path> elements whose bbox coincides with a <text> element (>= tol). */
export function coincidentOutlineIds(rows, tol = 0.6) {
  const texts = rows.filter((r) => r.id.startsWith('text') && r.w > 0 && r.h > 0);
  const paths = rows.filter((r) => r.id.startsWith('path') && r.w > 0 && r.h > 0);
  const ids = [];
  for (const p of paths) {
    for (const t of texts) {
      const ix = Math.max(0, Math.min(p.x + p.w, t.x + t.w) - Math.max(p.x, t.x));
      const iy = Math.max(0, Math.min(p.y + p.h, t.y + t.h) - Math.max(p.y, t.y));
      if ((ix * iy) / (p.w * p.h) >= tol) { ids.push(p.id); break; }
    }
  }
  return ids;
}

/** Remove elements (self-closing or paired) with the given ids. */
export function hideIds(svg, ids) {
  let out = svg;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`<[a-zA-Z]+\\b[^>]*\\bid="${esc}"[^>]*/>`, 'g'), '');
    out = out.replace(new RegExp(`<[a-zA-Z]+\\b[^>]*\\bid="${esc}"[^>]*>[\\s\\S]*?</[a-zA-Z]+>`, 'g'), '');
  }
  return out;
}

/** Advance widths of the shipped ArialMT (Liberation Sans renamed in the name
 *  table — metric-compatible with Arial), thousandths of an em. Used to
 *  segment glyph-split text back into words (issue #19). */
const ADVANCE = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584 };

const TSPAN_RE = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/;

/** Merge per-glyph <text> elements back into word runs (issue #19).
 *
 *  Inkscape's PDF import (observed 1.4.3 in the rebuilt image) can emit one
 *  <text> per CHARACTER when it cannot use the embedded font natively — the
 *  arialmt renaming keeps metrics right, but the split still happens. The
 *  run-based field patterns (title block) and readability need whole
 *  strings, so single-char texts on one baseline are re-segmented with the
 *  font's own advance widths: an excess gap ≈ one space inserts ' ', a much
 *  larger gap starts a new run (object/column boundary). Segments join into
 *  the first glyph's <text> (natural advance — metric-compatible font) and
 *  the remaining glyph elements are removed, keeping ids unique. Healthy
 *  conversions with no per-glyph splitting pass through byte-identical.
 *
 *  mergeGlyphTexts(svg) -> { svg, merged: <segments created> } */
export function mergeGlyphTexts(svg) {
  const blocks = [];
  for (const m of String(svg).matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)) {
    const raw = m[0];
    const open = raw.match(/^<text\b[^>]*>/)[0];
    const inner = raw.slice(open.length, raw.length - '</text>'.length);
    const tm = open.match(/matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)/);
    const ts = inner.match(TSPAN_RE);
    if (!tm || !ts) continue;
    // only axis-aligned single-char runs are glyph splits — rotated text and
    // whole-string texts are left alone
    if (Math.abs(+tm[2]) > 1e-6 || Math.abs(+tm[3]) > 1e-6) continue;
    const char = ts[2].replace(/<[^>]+>/g, '');
    if (char.length !== 1 || char === ' ' || char === '&') continue;
    const style = ts[1].replace(/\bid="[^"]*"/, '');
    const fs = style.match(/font-size:\s*([\d.]+)px/);
    if (!fs) continue;
    blocks.push({ start: m.index, end: m.index + raw.length, raw, open, tsAttrs: ts[1], style, char, tx: +tm[5], ty: +tm[6], a: +tm[1], em: (+fs[1]) * (+tm[1]) });
  }
  const buckets = new Map();
  for (const b of blocks) {
    const key = `${b.style}|${Math.round(b.ty / 0.6)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }
  const out = { svg, merged: 0 };
  let replaced = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    group.sort((p, q) => p.tx - q.tx);
    // per-baseline tracking estimate: the tightest excess gaps are plain
    // letter advances — tracked text raises every gap by the tracking amount
    const em = group[0].em;
    const excessOf = (prev, b) => b.tx - prev.tx - (ADVANCE[prev.char] ?? 556) / 1000 * prev.em;
    const small = group.slice(1).map((b, i) => excessOf(group[i], b)).filter((e) => e < 0.278 * em);
    small.sort((a, b) => a - b);
    const track = Math.min(Math.max(small.length ? small[Math.floor(small.length / 2)] : 0, 0), 0.6 * em);
    // segment: same baseline, same style; an excess ≈ one space width (plus
    // tracking) inserts ' ', a much larger excess starts a new run (object/
    // column boundary). Kerning/tracking joins without a space, so tracked
    // text rebuilds as a clean string — matching healthy conversions.
    const segs = [];
    let cur = { text: group[0].char, blocks: [group[0]], prev: group[0] };
    for (const b of group.slice(1)) {
      const excess = excessOf(cur.prev, b);
      // a colon ends a title-block label ("Drawing No :", "Product Name :") —
      // the value after it is its own run, exactly as a healthy conversion
      // emits it, so value patterns match and bindings stay label-free
      if (cur.prev.char === ':' || excess >= 1.4 * b.em + track) { segs.push(cur); cur = { text: b.char, blocks: [b], prev: b }; continue; }
      cur.text += excess >= 0.278 * b.em + track - 0.11 * b.em ? ' ' + b.char : b.char;
      cur.blocks.push(b);
      cur.prev = b;
    }
    segs.push(cur);
    for (const s of segs) {
      if (s.blocks.length < 2) continue; // a lone glyph has nothing to merge
      const first = s.blocks[0];
      const open = first.open.replace(/\s*clip-path="url\(#[^)]*\)"/, '');
      const text = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      replaced.push({ start: first.start, end: first.end, with: `${open}<tspan${first.tsAttrs}>${text}</tspan></text>` });
      for (const b of s.blocks.slice(1)) replaced.push({ start: b.start, end: b.end, with: '' });
      out.merged++;
    }
  }
  if (!out.merged) return out;
  replaced.sort((p, q) => q.start - p.start); // apply right-to-left, offsets stay valid
  let text = String(svg);
  for (const r of replaced) text = text.slice(0, r.start) + r.with + text.slice(r.end);
  out.svg = text;
  return out;
}
