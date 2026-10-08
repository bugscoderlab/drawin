// LLM-proposed derived formulas for scaffolded templates (PLAN.md §1B spirit).
//
//   const formulas = await proposeFormulas(params);  // { dim4: '(dim2 * 0.806).toFixed(2)' }
//
// One cheap TEXT call per scaffold (cost control: only when >= 2 numeric dims).
// The model sees the proposed dimension params (id, label, value) and decides which
// values are structurally derived from which (segment of an overall, scaling part,
// constant offset). Every proposal is validated numerically before being accepted:
// the expression must reproduce the drawing's own value at the drawing's inputs.
// Never throws — any failure yields {}.

import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig } from '../config/env.mjs';

const isNumeric = (v) => /^[0-9][0-9,]*(\.\d+)?$/.test(String(v).trim());
const decimals = (v) => { const m = String(v).trim().match(/\.(\d+)$/); return m ? m[1].length : 0; };

/** ids used inside an expression (whole-word, not preceded by a dot or digit) */
const refsIn = (expr) => (expr.match(/(?<![.\d])\b[a-zA-Z_]\w*\b/g) || []).filter((w) => w !== 'Math');

const EXPR_RE = /^[0-9a-zA-Z_][0-9a-zA-Z_+\-*/(). ]*$/;

function validate(expr, id, numeric) {
  if (typeof expr !== 'string' || !EXPR_RE.test(expr)) return null;
  const known = new Set(numeric.map((p) => p.id));
  const refs = refsIn(expr);
  if (!refs.length || refs.some((r) => !known.has(r) || r === id)) return null;
  const scope = Object.fromEntries(numeric.map((p) => [p.id, parseFloat(String(p.value).replace(/,/g, ''))]));
  let n;
  try { n = Function(...Object.keys(scope), `return (${expr});`)(...Object.values(scope)); }
  catch { return null; }
  if (!Number.isFinite(n)) return null;
  // Must reproduce the drawing's own value (2% relative slack for rounded ratios).
  const target = parseFloat(String(numeric.find((p) => p.id === id).value).replace(/,/g, ''));
  if (Math.abs(n - target) > Math.max(0.02, Math.abs(target) * 0.02)) return null;
  const d = decimals(numeric.find((p) => p.id === id).value);
  return `(${expr}).toFixed(${d})`;
}

export async function proposeFormulas(params, { timeoutMs = 20000 } = {}) {
  const numeric = params.filter((p) => isNumeric(p.value ?? p.default));
  if (numeric.length < 2) return {};
  const cfg = llmConfig();
  if (!cfg.hasKey) return {};

  const list = numeric.map((p) => ({ id: p.id, label: p.label, value: String(p.value ?? p.default) }));
  const system = 'You relate dimensions on aluminium ladder / scaffolding shop drawings.';
  const text = `Dimension parameters (id, label, value in mm):
${JSON.stringify(list)}

A formula marks a value that must move with another dimension: a segment of an overall length, a part that keeps a fixed ratio to an overall, or a constant offset.
Rules:
- Expressions use the given ids, numbers, and + - * / ( ) only.
- A rounded multiplicative ratio (e.g. "dim2 * 0.806075") is the right shape when a part scales with an overall.
- The expression only needs to match the value approximately (rounding); close is accepted.
Return JSON: {"formulas":{"<paramId>":"<expression>", ...}} — {} if none.

Example:
[{"id":"dimA","label":"Dimension A","value":"6000.00"},{"id":"dimB","label":"Dimension B","value":"4500.00"}]
→ {"formulas":{"dimB":"dimA * 0.75"}}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const { text: reply } = await callLLM({ system, text, json: true, maxTokens: 800, temperature: 0, signal: ctrl.signal });
    clearTimeout(t);
    const j = parseJSON(reply);
    const out = {};
    for (const [id, expr] of Object.entries(j.formulas || {})) {
      const ok = validate(expr, id, numeric);
      if (ok) out[id] = ok;
    }
    return out;
  } catch {
    return {};
  }
}
