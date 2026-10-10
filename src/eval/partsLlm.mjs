// LLM part-binding proposals (spec #15, docs/plans/llm-part-bindings.md).
//
// The deterministic part proposal (spec #8) is deliberately conservative and
// leaves visually-clear cases skipped — elements crossing the moving plane,
// connection plates between a stretched rail and a static neighbour. This
// pass asks a vision model to pick WHICH elements a dimension measures, and
// the engine keeps ALL the math: ids are validated against the deterministic
// stage's candidate pool (exists, unclaimed, inside the locality box), the op
// is derived from the model's role ("spans" -> stretch with the about end on
// the datum side; "attached" -> shift at the full rate), and anchor/pxPerUnit
// are always self-calibrated from the dim itself. The model emits no numbers.
//
//   const lp = await proposeLlmParts({ file, recs, usable, claimed, call });
//   // -> { bindings, byDim, rejected, summary } | null (disabled/no key/none eligible)
//
// `call` injects a fake LLM ({ system, text, image }) -> { text } (tests);
// without a call and without a key the pass is a quiet no-op, like vision.
// A failing dim never fails the scaffold — it just keeps its deterministic
// result (resilience rule: reported or quiet, never thrown).

import { llmConfig } from '../config/env.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { pagePng } from './pdf.mjs';
import { deriveAbout, inLocality } from './scaffold.mjs';

const SYSTEM = 'You decide which geometry elements a dimension measures on aluminium ladder / scaffolding shop drawings. You pick element ids and a role; you never emit coordinates, scales, or transforms — the toolchain derives all geometry.';

/** Dim and candidate context for one call. The candidate table is the ONLY
 *  ids the model may pick from — validation is table membership. */
function promptFor(rec, candidates) {
  const { p, line, extent, vertical, datum, moving } = rec;
  const axis = vertical ? 'y' : 'x';
  const len = (q, a) => (a === 'y' ? q.h : q.w);
  const d0 = line[axis], d1 = d0 + len(line, axis);
  const fmt = (n) => Math.round(n * 10) / 10;
  const table = candidates
    .map((r) => `${r.id}  ${fmt(r.x)},${fmt(r.y)} ${fmt(r.w)}x${fmt(r.h)}`)
    .join('\n');
  return `Dimension "${p.id}" = ${p.value} mm, measured along the ${axis.toUpperCase()} axis.
Its dimension line runs from ${axis}=${fmt(d0)} to ${axis}=${fmt(d1)} (page px, ${fmt(extent)} px long). The datum (fixed) end is at ${axis}=${fmt(datum[axis])}; the moving end at ${axis}=${fmt(moving ? moving[axis] : d1)} — when the value grows, geometry grows away from the datum end.
Candidate elements inside this dimension's locality (bbox = x,y w×h, page px):
${table}
Which candidates does THIS dimension measure?
- "spans": the element stretches between the dimension's end planes (rails, bars, frames spanning the measured width/height).
- "attached": the element rides the moving end (plates, bolts, brackets fixed to the moving-side plane). Elements on the datum side stay fixed — never pick them.
Reply JSON: {"spans":["id",...],"attached":["id",...]} — ids from the candidate table only; omit a key when nothing qualifies.`;
}

/**
 * @param {object} arg
 * @param {string} arg.file       source PDF (page image rendered once, lazily)
 * @param {object} arg.image      injected page image (tests) — skips rendering
 * @param {Array}  arg.recs       proposeGeometry recs eligible for a call
 *                                (dims whose deterministic proposal skipped)
 * @param {Array}  arg.usable     query-all rows the deterministic stage used
 * @param {Set}    arg.claimed    shared exclusion set (mutated: accepted ids join)
 * @param {Function} arg.matrixOf id -> matrix match (the deterministic stage's)
 * @param {Function} [arg.call]   fake LLM (tests); default callLLM
 * @param {number} [arg.timeoutMs]
 */
export async function proposeLlmParts({ file, image, recs, usable, claimed, matrixOf, call, timeoutMs = 30000 } = {}) {
  if (!recs?.length) return null;
  if (!call && !llmConfig().hasKey) return null;
  const bindings = [];
  const byDim = {};
  const rejected = [];
  let page = image || null;
  for (const rec of recs) {
    const candidates = usable.filter((r) => !claimed.has(r.id) && inLocality(r, rec.line, rec.extent, rec.vertical));
    if (!candidates.length) continue;
    const pick = new Map(candidates.map((r) => [r.id, r]));
    let j = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const doCall = call || callLLM;
      try {
        if (page === null && file) page = pagePng(file);
        ({ text: j } = await doCall({ system: SYSTEM, text: promptFor(rec, candidates), image: page || undefined, json: true, maxTokens: 1500, temperature: 0, signal: ctrl.signal }));
      } finally {
        // a throwing call must not hold the process until the timeout
        clearTimeout(t);
      }
      j = parseJSON(j);
    } catch {
      continue; // one dim's failure keeps the others and the scaffold running
    }
    const v = parseFloat(String(rec.p.value).replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) continue;
    const axis = rec.vertical ? 'Y' : 'X';
    const s = rec.extent / v;
    const seen = new Set();
    const accept = (ids, role) => {
      for (const id of ids || []) {
        const r = pick.get(id);
        if (!r) { rejected.push({ param: rec.p.id, id: String(id), reason: 'not an eligible candidate' }); continue; }
        if (seen.has(id)) { rejected.push({ param: rec.p.id, id: String(id), reason: 'picked twice' }); continue; }
        seen.add(id);
        claimed.add(id);
        const geom = role === 'spans'
          ? { op: `stretch${axis}`, about: deriveAbout(matrixOf, r, { vertical: rec.vertical, datumC: rec.datum[rec.vertical ? 'y' : 'x'] }), anchor: v }
          : { op: `shift${axis}`, anchor: v, pxPerUnit: s };
        bindings.push({ ids: [id], param: rec.p.id, geom });
        byDim[rec.p.id] = (byDim[rec.p.id] || 0) + 1;
      }
    };
    accept(j?.spans, 'spans');
    accept(j?.attached, 'attached');
  }
  if (!bindings.length && !rejected.length) return null;
  return { bindings, byDim, rejected, summary: { asked: recs.length, bound: bindings.length, rejected: rejected.length } };
}

/** Merge an accepted LLM proposal into the scaffold result: bindings join the
 *  template, per-dim counts gain an `llm` provenance split, and accepted ids
 *  join the fresh-bound set so the preserve step can never double-bind them
 *  (issue #12). An ambiguous dim KEEPS its flag — the LLM adds bindings, it
 *  does not silently resolve doubt (spec #15). Returns { parts, freshGeomIds }. */
export function mergeLlmParts(parts, tplBindings, freshGeomIds, lp) {
  tplBindings.push(...lp.bindings);
  const fresh = new Set([...freshGeomIds, ...lp.bindings.flatMap((b) => b.ids || [])]);
  const merged = parts.map((d) => {
    const n = lp.byDim[d.param] || 0;
    return n ? { ...d, bound: d.bound + n, llm: n } : d;
  });
  return { parts: merged, freshGeomIds: fresh };
}
