// LLM-proposed derived formulas for scaffolded templates (PLAN.md §1B spirit,
// geometry-aware since 1C.8b).
//
//   const r = await proposeFormulas(params);  // { formulas: { dim4: '(dim2 * 0.806).toFixed(2)' }, constants: {} }
//
// One cheap TEXT call per scaffold (cost control: only when >= 2 numeric dims).
// The model sees each proposed dimension param (id, label, value) PLUS its
// geometry — measure axis, text position, glyph span — so it can propose
// structural rules that values alone hide (PLAN 1C.8b): parallel dims that
// extend together (sum/difference), constant offsets. 1C.8a could only fit
// ratios (e.g. it proposed `dim6 = dim2 * 0.806075` on lsb-2607-004 where the
// true rule was a parallel extension).
//
// Every proposal is validated numerically before being accepted: the
// expression must reproduce the drawing's own value at the drawing's inputs.
// Additive numeric literals become named constant params (`<id>_const`) so a
// physical constant is editable instead of buried in the formula; ratios stay
// inline. Never throws — any failure yields { formulas: {}, constants: {} }.

import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig } from '../config/env.mjs';

const isNumeric = (v) => /^[0-9][0-9,]*(\.\d+)?$/.test(String(v).trim());
const decimals = (v) => { const m = String(v).trim().match(/\.(\d+)$/); return m ? m[1].length : 0; };

/** ids used inside an expression (whole-word, not preceded by a dot or digit) */
const refsIn = (expr) => (expr.match(/(?<![.\d])\b[a-zA-Z_]\w*\b/g) || []).filter((w) => w !== 'Math');

const EXPR_RE = /^[0-9a-zA-Z_][0-9a-zA-Z_+\-*/(). ]*$/;

/** Numeric literals of additive (+/-) terms — those are physical constants. */
const additiveLiterals = (expr) => {
  const out = [];
  let depth = 0, term = '';
  const terms = [];
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if ((ch === '+' || ch === '-') && depth === 0) { terms.push(term); term = ''; continue; }
    term += ch;
  }
  terms.push(term);
  for (const t of terms) {
    const u = t.trim();
    // a pure number, possibly after a * or / chain? Only bare literals count
    // ("2 * 150" is a product, not an offset; leave it inline).
    if (/^-?[\d.]+$/.test(u)) out.push(parseFloat(u));
  }
  return out;
};

function evaluate(expr, scope) {
  try { return Function(...Object.keys(scope), `return (${expr});`)(...Object.values(scope)); }
  catch { return NaN; }
}

/**
 * Validate one proposal and rewrite additive literals as named constants.
 * `numeric` = [{id, value}] dims; `extraIds` = already-created constant ids.
 * Returns { formula, constants: [{ id, value }] } or null.
 */
function validate(expr, id, numeric, extraIds = []) {
  if (typeof expr !== 'string' || !EXPR_RE.test(expr)) return null;
  const known = new Set([...numeric.map((p) => p.id), ...extraIds]);
  const refs = refsIn(expr);
  if (!refs.length || refs.some((r) => !known.has(r) || r === id)) return null;

  const scope = Object.fromEntries(numeric.map((p) => [p.id, parseFloat(String(p.value).replace(/,/g, ''))]));
  const target = parseFloat(String(numeric.find((p) => p.id === id).value).replace(/,/g, ''));
  const d = decimals(numeric.find((p) => p.id === id).value);

  // Rewrite bare additive literals as named constants (editable, not buried).
  const constants = [];
  let rewritten = expr;
  for (const lit of [...new Set(additiveLiterals(expr))]) {
    const cid = `${id}_c${constants.length + 1}`;
    const re = new RegExp(`(?<![.\\d])${lit < 0 ? `-?${Math.abs(lit)}` : `${lit}`}(?![\\d.])`);
    // replace only the first bare occurrence of this literal
    if (!re.test(rewritten)) return null;
    rewritten = rewritten.replace(re, lit < 0 ? `- ${cid}` : cid);
    constants.push({ id: cid, value: Math.abs(lit) });
  }
  const scope2 = { ...scope, ...Object.fromEntries(constants.map((c) => [c.id, c.value])) };
  const n = evaluate(rewritten, scope2);
  if (!Number.isFinite(n)) return null;
  // Must reproduce the drawing's own value (2% relative slack for rounding).
  if (Math.abs(n - target) > Math.max(0.02, Math.abs(target) * 0.02)) return null;
  return { formula: `(${rewritten}).toFixed(${d})`, constants };
}

/**
 * params: [{ id, label, value, geom? }] — geom = { axis: 'x'|'y', pos: [cx, cy], spanPx }
 * opts.call: injectable LLM fn ({ system, text }) -> { text } (tests).
 * Returns { formulas: { id: expr }, constants: { constId: number } }.
 */
export async function proposeFormulas(params, { timeoutMs = 20000, call } = {}) {
  const empty = { formulas: {}, constants: {} };
  const numeric = params.filter((p) => isNumeric(p.value ?? p.default));
  if (numeric.length < 2) return empty;
  if (!call && !llmConfig().hasKey) return empty;

  const list = numeric.map((p) => ({ id: p.id, label: p.label, value: String(p.value ?? p.default) }));
  const geomLines = numeric
    .filter((p) => p.geom)
    .map((p) => `${p.id}: axis=${p.geom.axis} textPos=(${p.geom.pos.join(',')}) glyphSpan=${p.geom.spanPx}px`);
  const system = 'You relate dimensions on aluminium ladder / scaffolding shop drawings.';
  const text = `Dimension parameters (id, label, value in mm):
${JSON.stringify(list)}
${geomLines.length ? `
Drawing geometry of each dimension (axis = measure direction, textPos = sheet position of the dimension TEXT in px, glyphSpan = width of the text in px):
${geomLines.join('\n')}
` : ''}
A formula marks a value that must move with other dimensions. Prefer structural rules over fitted ratios when the geometry suggests them:
- Dimensions whose lines run parallel and at nearby positions often extend together — propose the sum/difference (e.g. "dimA + dimB - dimC - 150" when one overall is composed of segments and a constant bracket depth).
- Additive offsets are physical constants: write them as plain numbers.
- A multiplicative ratio (e.g. "dim2 * 0.806075") is the right shape only when a part scales with an overall and no segment structure is visible.
Rules:
- Expressions use the given ids, numbers, and + - * / ( ) only.
- The expression only needs to match the value approximately (rounding); close is accepted.
Return JSON: {"formulas":{"<paramId>":"<expression>", ...}} — {} if none.

Example:
[{"id":"dimA","label":"Dimension A","value":"6000.00"},{"id":"dimB","label":"Dimension B","value":"4500.00"}]
→ {"formulas":{"dimB":"dimA * 0.75"}}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const doCall = call || callLLM;
    const { text: reply } = await doCall({ system, text, json: true, maxTokens: 800, temperature: 0, signal: ctrl.signal });
    clearTimeout(t);
    const j = parseJSON(reply);
    const out = { formulas: {}, constants: {} };
    const made = []; // constants created by earlier formulas in this reply
    for (const [id, expr] of Object.entries(j.formulas || {})) {
      const ok = validate(expr, id, numeric, made);
      if (ok) {
        out.formulas[id] = ok.formula;
        for (const c of ok.constants) { out.constants[c.id] = c.value; made.push(c.id); }
      }
    }
    return out;
  } catch {
    return empty;
  }
}
