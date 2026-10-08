// Typed-value normalization for extracted fields (PLAN 1.3).

/** "3,500 MM" | "2372" | 2372 | "7.5" -> number | null */
export function parseNumber(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "150KG" | "150 KG" | 150 -> "150KG" | null (anchored: "1500 KG" is not a load) */
export function parseLoad(v) {
  const m = String(v ?? '').match(/^(\d{2,3})\s*KG$/i);
  return m ? `${m[1]}KG` : null;
}

/** "60" | "60°" | "(60°)" -> "60" | null */
export function parseAngle(v) {
  const m = String(v ?? '').match(/(\d{1,2})\s*°?/);
  return m ? m[1] : null;
}

/** dd-mm-yyyy sanity check -> the date | null */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  return /^\d{1,2}-\d{1,2}-\d{4}$/.test(s) ? s : null;
}

/** "6650mm + 900mm" style note -> { a: 6650, b: 900 } | null */
export function parseHeightPair(sq) {
  const hp = String(sq ?? '').match(/Height:?([\d,]+)mm\+([\d,]+)mm/i);
  return hp ? { a: Number(hp[1].replace(/,/g, '')), b: Number(hp[2].replace(/,/g, '')) } : null;
}
