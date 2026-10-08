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
