// Rule-based field extractor (Channel B baseline).
// Operates on poppler `pdftotext -layout` output.
//
// Notes:
//  - Illustrator/poppler fragment glyphs ("Heigh t : 6 650mm"), so height-style
//    patterns match on a whitespace-stripped copy;
//  - company detection runs on the raw layout (multi-space field boundaries)
//    plus a targeted pass that bridges the "FHL CONSTRUCTION … Tel SDN BHD" split;
//  - cannot read dimension callouts that never reach the text layer (cat's
//    "3210", the trolley platform numbers) — that is the LLM's job.

const MANUFACTURERS = /LADDERTECH|LADDER\s*TECH|NEW\s*AGE|NAR\b/i;
const TOKEN = "[A-Z&][A-Z0-9&.'-]* ";

export function extractRules(text, module) {
  const t = String(text).replace(/\u00a0/g, ' ');
  const flat = t.replace(/\s+/g, ' ');
  const sq = flat.replace(/\s+/g, '');
  const m = (s, re) => { const x = s.match(re); return x ? (x[1] ?? x[0]).trim() : null; };

  const out = {};

  out.productType = /\bCAGE\b|CAGE\s*RING/i.test(flat) ? 'cage'
    : /TROLLEY/i.test(flat) ? 'trolley'
    : /\bCAT\s*LADDER\b/i.test(flat) ? 'cat'
    : (module ?? null);

  out.drawingNo = m(flat, /\b(LSB[-/][0-9A-Za-z]+(?:[-/][0-9A-Za-z]+)*)\b/);
  out.revision = m(flat, /\bRevision\s*:?\s*([A-Za-z0-9]{1,4})\b/) ?? m(flat, /\bRev\s*:?\s*([A-Za-z0-9]{1,4})\b/);
  out.customer = company(t, flat);

  out.material = m(flat, /\bMaterial\s+(?!Finishing|Customer|Date|Unit\b)([A-Za-z0-9]+)/);
  out.finishing = m(flat, /\bFinishing\s+(?!Customer|Date|Unit\b)([A-Za-z0-9]+)/);
  out.workingLoad = m(flat, /\b(\d{2,3}\s*KG)\b/i);
  out.date = m(flat, /\b(\d{1,2}-\d{1,2}-\d{4})\b/);

  if (/SAFETY LADDER TROLLEY/i.test(flat)) out.productName = m(flat, /(ALUMINIUM SAFETY LADDER TROLLEY \d+ STEP \(CUSTOMIZED\))/);
  else if (/CAT LADDER BODY TYPE/i.test(flat)) out.productName = m(flat, /(ALUMINIUM CAT LADDER BODY TYPE)/);

  out.steps = m(flat, /\b(\d{1,2})\s*STEP\b/i);
  out.angle = m(flat, /\((\d{1,2})°\)/) ?? m(flat, /\b(\d{1,2})°/);
  out.overallHeight = m(sq, /Height:?([\d,]+)(?:MM|mm)/i);

  const hp = sq.match(/Height:?([\d,]+)mm\+([\d,]+)mm/i);
  if (hp) {
    out.floorToLanding = hp[1].replace(/,/g, '');
    out.handrailHeight = hp[2].replace(/,/g, '');
  }

  return out;
}

/** Buyer company, skipping the manufacturer named on the sheet. */
function company(raw, flat) {
  const found = [];
  // Raw layout: multiple spaces separate fields, so tokens don't chain across columns.
  for (const m of raw.matchAll(new RegExp(`((?:${TOKEN}){0,6})SDN\\.? ?BHD`, 'g'))) push(found, m[1]);
  // Bridged split: "FHL CONSTRUCTION … Tel SDN BHD".
  for (const m of flat.matchAll(new RegExp(`((?:${TOKEN}){0,6})Tel ?SDN\\.? ?BHD`, 'g'))) push(found, m[1]);

  const uniq = [...new Set(found)];
  return uniq.find((n) => !MANUFACTURERS.test(n)) ?? uniq[0] ?? null;
}

function push(arr, prefix) {
  const name = `${prefix.trim()} SDN BHD`.replace(/\s+/g, ' ').trim();
  if (name !== 'SDN BHD') arr.push(name);
}
