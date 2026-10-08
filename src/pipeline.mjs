// generate + verify (PLAN 2.1c/d) — the close of the loop:
//
//   extract ──► generate ──► SVG whose bound text carries the extracted values
//                 │verify re-extracts and checks each dimension appears in it
//
// generateFromExtract(): match a template from the extracted signals; render
// L1 real art (params bound by id overlap) or fall back to the L3 code model.
// verifyPdf(): extract → generate → confirm every extracted dimension (>=10,
// to skip revision/noise) appears in the generated drawing's text layer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry, matchTemplate } from './templates/registry.mjs';
import { resolveParams, renderTemplate, textRuns, orderedLists } from './templates/render.mjs';
import { splitSvgDocument, toDocument } from './templates/renderCmd.mjs';
import { renderDocument } from './core/render.mjs';
import { paramsFor } from './core/modules.mjs';
import { parseNumber } from './extract/normalize.mjs';
import { extractParams } from './extract/extract.mjs';

/**
 * Render an `extractParams` result to a standalone SVG.
 * Returns { svg, via, bound, unbound, match }.
 */
export function generateFromExtract(extract, { templatesDir }) {
  const p = extract.params ?? {};
  const module = extract.module ?? 'cat';
  const { templates } = loadRegistry(templatesDir);
  // productName is the strongest title signal; fall back to the module's
  // classification keyword (itself derived from text keywords by the rules).
  const TITLE_HINT = { cage: 'SAFETY CAGE', trolley: 'LADDER TROLLEY', cat: 'CAT LADDER' };
  const signals = {
    title: p.productName ?? TITLE_HINT[module],
    drawingNo: p.drawingNo ?? null,
    dimensions: Object.values(p).map(parseNumber).filter((n) => n !== null),
  };
  const hit = matchTemplate(templates, signals);

  if (hit && hit.template.kind === 'l1') {
    const tpl = hit.template;
    const doc = readFileSync(join(tpl.dir, tpl.base.svg), 'utf8');
    const values = {};
    const bound = [], unbound = [];
    for (const param of tpl.params) {
      const v = p[param.id];
      if (v != null && v !== '') { values[param.id] = String(v); bound.push(param.id); }
      else unbound.push(param.id);
    }
    const eff = resolveParams(tpl.params, values);
    const { svg } = renderTemplate(doc, tpl.bindings, eff);
    const parts = splitSvgDocument(svg);
    return { svg: toDocument(parts.inner, parts), via: `l1:${tpl.id}`, bound, unbound, match: hit };
  }

  const useModule = hit?.template?.module ?? extract.module ?? 'cat';
  const core = extract.core ?? {};
  const r = renderDocument(useModule, paramsFor(useModule, core));
  if (r.error) return { svg: null, via: `l3:${useModule}`, error: r.error, match: hit };
  return { svg: r.document, via: `l3:${useModule}`, bound: [], unbound: [], match: hit };
}

const digits = (s) => String(s).replace(/\D/g, '');

/** Locate a number's digit string in the SVG text layer (run or glyph group). */
export function findNumber(runs, num) {
  const target = digits(Math.round(num));
  if (!target) return null;
  for (const r of runs) if (digits(r.text).includes(target)) return { where: 'run', text: r.text.trim() };
  for (const list of orderedLists(runs)) {
    for (let i = 0; i < list.length; i++) {
      let acc = '';
      for (let j = i; j < list.length && acc.length <= target.length + 2; j++) {
        acc += digits(list[j].text);
        if (acc.includes(target)) return { where: 'group', text: list.slice(i, j + 1).map((r) => r.text.trim()).join('') };
      }
    }
  }
  return null;
}

/**
 * Verify: every extracted dimension (>= 10) must appear in the generated
 * drawing's text layer. Non-dimension fields (dates, names) are reported as
 * skipped — the check is about geometry values. Never throws for weird input.
 */
export async function verifyPdf(pdfPath, { llm = 'auto', templatesDir } = {}) {
  const extract = await extractParams(pdfPath, { llm });
  const gen = generateFromExtract(extract, { templatesDir });
  const checks = [];
  const skipped = [];
  if (gen.svg) {
    const runs = textRuns(gen.svg);
    for (const [field, value] of Object.entries(extract.params ?? {})) {
      const n = parseNumber(value);
      if (n === null || n < 10) { skipped.push(field); continue; }
      const found = findNumber(runs, n);
      checks.push({ field, value, ok: !!found, where: found?.where ?? null });
    }
  } else {
    for (const [field, value] of Object.entries(extract.params ?? {})) {
      const n = parseNumber(value);
      if (n !== null && n >= 10) checks.push({ field, value, ok: false, where: null, reason: gen.error ?? 'no svg' });
      else skipped.push(field);
    }
  }
  const ok = checks.filter((c) => c.ok).length;
  return { extract, via: gen.via, bound: gen.bound, unbound: gen.unbound, checks, skipped, ok, total: checks.length };
}
