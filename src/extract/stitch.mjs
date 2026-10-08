// Stitch raw `pdftotext -layout` output into matchable forms.
//
// Illustrator/poppler fragment glyphs per run ("Heigh t : 6 650mm",
// "2 0 5 3 . 6"), so patterns cannot rely on spacing. Three views:
//   raw  — nbsp-normalized original (multi-space column boundaries intact)
//   flat — whitespace collapsed to single spaces (label/value patterns)
//   sq   — whitespace stripped entirely (de-fragmentation; height patterns)
//   lines— non-empty raw lines, for profiles and unmapped-text reporting

export function stitchText(text) {
  const raw = String(text).replace(/ /g, ' ');
  return {
    raw,
    flat: raw.replace(/\s+/g, ' ').trim(),
    sq: raw.replace(/\s+/g, ''),
    lines: raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  };
}

/** Bridge a company name split across layout columns: "FHL CONSTRUCTION … Tel SDN BHD". */
export function bridgeCompany(flat) {
  const TOKEN = "[A-Z&][A-Z0-9&.'-]* ";
  const out = [];
  for (const m of flat.matchAll(new RegExp(`((?:${TOKEN}){0,6})Tel ?SDN\\.? ?BHD`, 'g'))) {
    const name = `${m[1].trim()} SDN BHD`.replace(/\s+/g, ' ').trim();
    if (name !== 'SDN BHD') out.push(name);
  }
  return [...new Set(out)];
}
