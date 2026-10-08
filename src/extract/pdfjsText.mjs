// Browser/Node text-layer access via pdf.js (PLAN 2.6 / P1 spike).
//
//   const layout = await pdfjsLayout(new Uint8Array(pdfBytes))  // Node
//   // browser (legacy UMD): pdfjsLayout(new Uint8Array(bytes), window.pdfjsLib)
//
// pdf.js text items carry coordinates, so items are clustered into lines by
// baseline y and joined left-to-right with column gaps preserved — producing
// a `pdftotext -layout`-shaped string that feeds the SAME stitch/rules
// pipeline as the CLI. One ruleset, two runtimes (PLAN: no rule drift).
//
// NOTE (measured): the corpus PDFs subset fonts in ways pdf.js cannot always
// decode (Type0/Type3 without embedded ToUnicode cMaps — "translateFont
// failed"), so item counts are far lower than poppler's. For this corpus the
// CLI (poppler) stays the extractor of record; pdf.js is the in-browser path
// for PDFs with a well-formed text layer, and the server flow covers the rest.

export async function pdfjsLayout(data, lib) {
  const pdfjs = lib ?? (await import('pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out.push(itemsToLayout(tc.items));
  }
  return out.join('\n');
}

/**
 * Cluster text items into a layout string: group by baseline y (tolerance by
 * line height), sort each line by x, join with a space per ~2.2 chars of gap
 * (like `pdftotext -layout`'s column separation).
 */
export function itemsToLayout(items) {
  const runs = [];
  for (const it of items) {
    const str = String(it.str ?? '');
    if (!str.trim()) continue;
    const [, , , , x, y] = it.transform ?? [0, 0, 0, 0, 0, 0];
    const h = Math.hypot(it.transform?.[2] ?? 0, it.transform?.[3] ?? 16) || 16;
    runs.push({ str, x, y, w: it.width ?? str.length * h * 0.5, h });
  }
  // cluster by baseline y
  const lines = [];
  for (const r of runs.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= Math.max(2, r.h * 0.35));
    if (line) { line.runs.push(r); line.y = (line.y * (line.runs.length - 1) + r.y) / line.runs.length; }
    else lines.push({ y: r.y, runs: [r] });
  }
  const text = [];
  for (const line of lines.sort((a, b) => b.y - a.y)) {
    const rs = line.runs.sort((a, b) => a.x - b.x);
    let lineStr = '', prevEnd = null;
    for (const r of rs) {
      if (prevEnd !== null) {
        const gap = r.x - prevEnd;
        const spaces = Math.max(1, Math.round(gap / (r.h * 0.55)));
        lineStr += ' '.repeat(Math.min(spaces, 12));
      }
      lineStr += r.str;
      prevEnd = r.x + r.w;
    }
    text.push(lineStr);
  }
  return text.join('\n');
}
