// Template registry: load templates/<id>/template.json and match them to an
// uploaded drawing's generic signals. Never throws on a bad template — it is
// collected into `errors` and skipped (resilience rule: Channel A always works).
//
//   const { templates, errors } = loadRegistry(templatesDir)
//   const hit = matchTemplate(templates, signals)   // { template, score, hits } | null
//
// `signals` is generic metadata only — { title, drawingNo, dimensions } — no
// product classification. Scoring:
//   +3 per title keyword found in the title   (strong identity signal)
//   +2 if the drawing number matches the pattern (supporting signal)
//   +1 per expected dimension found           (supporting signal)
// Match requires score >= 4, i.e. at least one title keyword — a drawing-no
// pattern alone must never match (a generic LSB cat drawing would otherwise
// pick up the cage template). Ties prefer real-art L1 templates over L3 code
// models, then lowest id, so the result is deterministic.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// L3 code models (src/core/render) seeded as registry entries — the plan's
// 1C.5: cat/cage/trolley exist even where no L1 art template has been authored.
export const L3_TEMPLATES = [
  { id: 'cat-l3', kind: 'l3', name: 'Cat ladder body (model)', module: 'cat',
    match: { titleKeywords: ['CAT LADDER'], drawingNoPattern: '^LSB[-/]' } },
  { id: 'cage-l3', kind: 'l3', name: 'Safety cage ladder (model)', module: 'cage',
    match: { titleKeywords: ['CAGE'], drawingNoPattern: '^LSB[-/]' } },
  { id: 'trolley-l3', kind: 'l3', name: 'Safety ladder trolley (model)', module: 'trolley',
    match: { titleKeywords: ['TROLLEY'], drawingNoPattern: '^LSB[-/]' } },
];

const KIND_RANK = { l1: 0, l2: 0, l3: 1 }; // real art beats code models on ties

/** Load every templates/<id>/template.json under `dir`. Bad entries are skipped. */
export function loadRegistry(dir, { withL3 = true } = {}) {
  const templates = [], errors = [];
  for (const id of readdirSync(dir)) {
    const sub = join(dir, id);
    const file = join(sub, 'template.json');
    if (!statSync(sub, { throwIfNoEntry: false })?.isDirectory() || !existsSync(file)) continue;
    try {
      const tpl = JSON.parse(readFileSync(file, 'utf8'));
      validate(tpl, sub);
      templates.push({ ...tpl, kind: tpl.kind || 'l1', dir: sub });
    } catch (e) {
      errors.push({ dir: sub, error: e.message });
    }
  }
  return { templates: withL3 ? [...templates, ...L3_TEMPLATES] : templates, errors };
}

function validate(tpl, dir) {
  if (!tpl.id || typeof tpl.id !== 'string') throw new Error('template.json: missing "id"');
  if (!tpl.name) throw new Error('template.json: missing "name"');
  if (!tpl.base?.svg || !existsSync(join(dir, tpl.base.svg))) {
    throw new Error(`template.json: base.svg not found (${tpl.base?.svg ?? 'unset'})`);
  }
  if (!Array.isArray(tpl.params)) throw new Error('template.json: "params" must be an array');
  if (!Array.isArray(tpl.bindings)) throw new Error('template.json: "bindings" must be an array');
  if (tpl.match !== undefined && (typeof tpl.match !== 'object' || Array.isArray(tpl.match))) {
    throw new Error('template.json: "match" must be an object');
  }
}

const normStr = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Parse "3,500 MM" / "2372" / 2372 -> 2372 (null when not numeric). */
const toNum = (v) => {
  const n = parseFloat(String(v).replace(/,/g, '').match(/-?[\d.]+/)?.[0] ?? '');
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
};

/** Score one template against extracted signals. Pure — used by matchTemplate and tests. */
export function scoreTemplate(tpl, signals = {}) {
  const m = tpl.match || {};
  const title = normStr(signals.title);
  const drawingNo = normStr(signals.drawingNo);
  const dims = new Set((signals.dimensions ?? []).map(toNum).filter((n) => n !== null));

  let score = 0;
  const hits = { keywords: [], pattern: false, dimensions: [] };
  for (const kw of m.titleKeywords ?? []) {
    if (title.includes(normStr(kw))) { score += 3; hits.keywords.push(kw); }
  }
  if (m.drawingNoPattern && drawingNo) {
    try {
      if (new RegExp(m.drawingNoPattern, 'i').test(drawingNo)) { score += 2; hits.pattern = true; }
    } catch { /* invalid pattern in template — treated as no signal */ }
  }
  for (const d of m.dimensions ?? []) {
    const n = toNum(d);
    if (n !== null && dims.has(n)) { score += 1; hits.dimensions.push(d); }
  }
  return { score, hits };
}

/**
 * Best match above the threshold, or null (never an error — unmatched drawings
 * fall back to converted SVG + generic metadata upstream).
 */
export function matchTemplate(templates, signals, { threshold = 4 } = {}) {
  let best = null;
  for (const tpl of templates) {
    const { score, hits } = scoreTemplate(tpl, signals);
    if (score < threshold) continue;
    if (!best
      || score > best.score
      || (score === best.score && (KIND_RANK[tpl.kind] ?? 9) < (KIND_RANK[best.template.kind] ?? 9))
      || (score === best.score && (KIND_RANK[tpl.kind] ?? 9) === (KIND_RANK[best.template.kind] ?? 9) && tpl.id < best.template.id)) {
      best = { template: tpl, score, hits };
    }
  }
  return best;
}
