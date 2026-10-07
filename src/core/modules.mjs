// Single source of truth for the drawing modules and their fields.
// Mirrors the form controls in the original HTML (ids, defaults, min/max/step).
// The HTML form, the MCP inputSchema, and the CLI all read from here.

export const MODULES = {
  cat:     { label: 'Cat Ladder Body',           landscape: false },
  cage:    { label: 'Cat Ladder with Safety Cage', landscape: false },
  trolley: { label: 'Safety Ladder Trolley',     landscape: true },
};

// Field → default value. Numeric fields are numbers; text/select fields are strings.
export const DEFAULTS = {
  productType: 'cage',
  customer: 'FHL CONSTRUCTION SDN BHD',
  drawingNo: 'LSB/2607/004/FHL/R00',
  revision: '00',
  material: 'Aluminium',
  drawingDate: '2026-07-10',
  finish: 'MF',

  // cat
  rungs: 14, spacing: 295, width: 450, bottom: 150, top: 100,
  load: '150 kg', bracketDepth: '7.5 inch', centres: 1,
  notes: 'PRELIMINARY DRAWING FOR QUOTATION AND CUSTOMER CONFIRMATION ONLY. NOT FOR FABRICATION.',

  // trolley
  steps: 9, rise: 305, platformHeight: 2500, guardrailHeight: 1000, platformLength: 980,
  trolleyWidth: 700, footprint: 2372, angle: '60°', castor: '5-inch heavy duty',
  levelers: 4, groundClearance: 103, handrails: 'Both sides',
  trolleyNotes: 'PRELIMINARY DRAWING FOR QUOTATION AND CUSTOMER CONFIRMATION ONLY. NOT FOR FABRICATION.',

  // cage
  cageLadderHeight: 6650, cageHandrailHeight: 900, cageStartHeight: 2053.6, cageHeight: 5360.4,
  cageWidth: 450, cageProjection: 700, cageOuterWidth: 750, cageHandrailReturn: 500,
  cageRungSpacing: 295, cageBottomRung: 146, cageRings: 10, cageBrackets: 5, cageBracketDepth: 190.5,
  cageLoad: '150 kg', cageNotes: '',
};

// Numeric ranges + human labels (label used in validation messages).
export const RANGES = {
  rungs:              { min: 3, max: 30, step: 1, label: 'Number of rungs' },
  spacing:            { min: 150, max: 450, step: 1, label: 'Rung spacing' },
  width:              { min: 300, max: 900, step: 1, label: 'Outside width' },
  bottom:             { min: 0, max: 500, step: 1, label: 'Bottom allowance' },
  top:                { min: 0, max: 500, step: 1, label: 'Top allowance' },
  centres:            { min: 0, max: 6, step: 1, label: 'Centre brackets' },
  steps:              { min: 3, max: 20, step: 1, label: 'Number of steps' },
  rise:               { min: 200, max: 400, step: 1, label: 'Step spacing' },
  platformHeight:     { min: 600, max: 5000, step: 1, label: 'Platform height' },
  guardrailHeight:    { min: 800, max: 1400, step: 1, label: 'Guardrail height' },
  platformLength:     { min: 600, max: 2000, step: 1, label: 'Platform length' },
  trolleyWidth:       { min: 500, max: 1500, step: 1, label: 'Overall width' },
  footprint:          { min: 1200, max: 5000, step: 1, label: 'Overall footprint' },
  levelers:           { min: 0, max: 6, step: 1, label: 'Adjustable levellers' },
  groundClearance:    { min: 0, max: 300, step: 1, label: 'Ground clearance' },
  cageLadderHeight:   { min: 1000, max: 15000, step: 1, label: 'Floor to landing' },
  cageHandrailHeight: { min: 600, max: 1500, step: 1, label: 'Top handrail height' },
  cageStartHeight:    { min: 1500, max: 4000, step: 0.1, label: 'Cage starts from floor' },
  cageHeight:         { min: 1000, max: 12000, step: 0.1, label: 'Safety cage height' },
  cageWidth:          { min: 300, max: 900, step: 1, label: 'Ladder outside width' },
  cageProjection:     { min: 300, max: 1500, step: 1, label: 'Cage projection' },
  cageOuterWidth:     { min: 400, max: 1500, step: 1, label: 'Cage outside width' },
  cageHandrailReturn: { min: 150, max: 1000, step: 1, label: 'Handrail return depth' },
  cageRungSpacing:    { min: 200, max: 400, step: 1, label: 'Rung spacing' },
  cageBottomRung:     { min: 100, max: 400, step: 1, label: 'Bottom rung clearance' },
  cageRings:          { min: 2, max: 30, step: 1, label: 'Safety cage rings' },
  cageBrackets:       { min: 0, max: 20, step: 1, label: 'Centre brackets' },
  cageBracketDepth:   { min: 50, max: 600, step: 0.1, label: 'Bracket depth (mm)' },
};

// Fields that belong to each module (the "*-only" sections, plus shared fields).
const SHARED = ['productType', 'customer', 'drawingNo', 'revision', 'material', 'drawingDate', 'finish'];
export const MODULE_FIELDS = {
  cat: [...SHARED, 'rungs', 'spacing', 'width', 'bottom', 'top', 'load', 'bracketDepth', 'centres', 'notes'],
  trolley: [...SHARED, 'steps', 'rise', 'platformHeight', 'guardrailHeight', 'platformLength', 'trolleyWidth',
    'footprint', 'angle', 'castor', 'levelers', 'groundClearance', 'handrails', 'trolleyNotes'],
  cage: [...SHARED, 'cageLadderHeight', 'cageHandrailHeight', 'cageStartHeight', 'cageHeight', 'cageWidth',
    'cageProjection', 'cageOuterWidth', 'cageHandrailReturn', 'cageRungSpacing', 'cageBottomRung',
    'cageRings', 'cageBrackets', 'cageBracketDepth', 'cageLoad', 'cageNotes'],
};

/** Defaults merged with overrides, coerced to the module's field set. */
export function paramsFor(module, overrides = {}) {
  const fields = MODULE_FIELDS[module] || [];
  const out = {};
  for (const f of fields) out[f] = overrides[f] !== undefined ? overrides[f] : DEFAULTS[f];
  return out;
}

/** Range check for one numeric field. Returns null when valid, else a message. */
export function rangeError(field, value) {
  const r = RANGES[field];
  if (!r) return null;
  const v = Number(value);
  if (value === '' || value === null || value === undefined || Number.isNaN(v)) {
    return `Enter a valid ${r.label} (${r.min}–${r.max}).`;
  }
  if (v < r.min || v > r.max) return `Enter a valid ${r.label} (${r.min}–${r.max}).`;
  if (r.step && Math.abs(Math.round(v / r.step) * r.step - v) > 1e-6) {
    return `Enter a valid ${r.label} (${r.min}–${r.max}).`;
  }
  return null;
}
