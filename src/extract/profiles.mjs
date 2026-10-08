// Title-block sheet profiles (PLAN 1.5) — data, not code: a new vendor is a
// new entry here. Detection runs on the stitched text; with pdftotext there
// is no geometry, so the "title-block band" is approximated by profile
// signals rather than coordinates (the geometric version is part of the
// pdf.js extractor, where items carry positions).
//
// Each profile: detect(stitched) -> bool, apply(fields, stitched, fixes) ->
// corrections logged into `fixes`. First matching profile wins; `generic`
// always matches and applies no fixes.

export const PROFILES = {
  nar: {
    name: 'NAR shop drawing',
    detect: (s) => /\bNAR\b/i.test(s.flat),
    apply(fields, s, fixes) {
      // NAR sheets carry TWO drawing numbers (e.g. NAR-LA-LT-CL-060 vs
      // LSB-2607-003-RHC-R00) — the LSB number is the canonical one.
      const lsb = s.flat.match(/\b(LSB[-/][0-9A-Za-z]+(?:[-/][0-9A-Za-z]+)*)\b/);
      if (lsb && fields.drawingNo && fields.drawingNo !== lsb[0]) {
        fixes.push(`drawingNo: ${fields.drawingNo} -> ${lsb[0]} (LSB number is canonical on NAR sheets)`);
        fields.drawingNo = lsb[0];
      }
      if (lsb && !fields.drawingNo) fields.drawingNo = lsb[0];
      // Revision: fall back to the R-suffix of the drawing number.
      const rev = fields.drawingNo?.match(/R(\d{2})$/);
      if (rev && !fields.revision) {
        fixes.push(`revision: null -> ${rev[0]} (from drawing number)`);
        fields.revision = rev[0];
      }
    },
  },
  laddertech: {
    name: 'Laddertech sheet',
    detect: (s) => /laddertech/i.test(s.flat),
    apply() { /* corpus-clean; label-map corrections land here as needed */ },
  },
  generic: {
    name: 'generic',
    detect: () => true,
    apply() {},
  },
};

/** First matching profile wins. Returns { profile, fixes }. */
export function applyProfile(fields, stitched) {
  const fixes = [];
  for (const [id, p] of Object.entries(PROFILES)) {
    if (id !== 'generic' && !p.detect(stitched)) continue;
    p.apply(fields, stitched, fixes);
    return { profile: id, profileName: p.name, fixes };
  }
  return { profile: 'generic', profileName: 'generic', fixes };
}
