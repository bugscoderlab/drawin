// SVG text/line helpers — extracted verbatim from the original HTML generator.
// Pure, DOM-free.

export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = (v) => Number(v) || 0;
export const fmt = (v) => Math.round(v).toLocaleString('en-MY');

export function text(x, y, value, size = 11, weight = 400, anchor = 'start', extra = '') {
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="#17283a" ${extra}>${esc(value)}</text>`;
}
export function line(x1, y1, x2, y2, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#17283a" stroke-width="1.5" ${extra}/>`;
}
export function dimensionY(x, y1, y2, label) {
  return `${line(x, y1, x, y2, 'marker-start="url(#arrow)" marker-end="url(#arrow)"')}${line(x - 8, y1, x + 15, y1)}${line(x - 8, y2, x + 15, y2)}${text(x - 8, (y1 + y2) / 2, label, 11, 700, 'middle', `transform="rotate(-90 ${x - 8} ${(y1 + y2) / 2})"`)}`;
}
export function dimensionX(x1, x2, y, label) {
  return `${line(x1, y, x2, y, 'marker-start="url(#arrow)" marker-end="url(#arrow)"')}${line(x1, y - 10, x1, y + 10)}${line(x2, y - 10, x2, y + 10)}${text((x1 + x2) / 2, y - 8, label, 10, 700, 'middle')}`;
}
export function commonDefs() {
  return `<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M0,0 L7,3.5 L0,7 z" fill="#17283a"/></marker></defs>`;
}

/** dd-mm-yyyy, matching the original `Intl.DateTimeFormat('en-GB')` + replaceAll. */
export function isoDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(d)
    .replaceAll('/', '-');
}
