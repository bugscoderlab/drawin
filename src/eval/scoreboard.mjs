// A/B scoreboard core (PLAN 1B.7): rules vs LLM-text vs LLM-vision vs MERGED
// (rules-first), per field, against the TRUTH fixtures. Pure logic — the CLI
// surfaces are src/eval/eval.mjs (developer table) and `ladder eval`.
//
//   const { results, totals } = await scoreFiles(files, { text: false, vision: true })
//
// LLM methods are skipped (reported as null) when no API key is configured —
// the scoreboard still runs rules-only, which is what CI gets.

import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { pdftotext, pagePng, inferModule } from './pdf.mjs';
import { TRUTH, FIELDS, eq } from './truth.mjs';
import { extractRules } from '../extract/rules.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig, maskKey } from '../config/env.mjs';

const DESC = {
  productType: 'one of trolley|cat|cage. cage = a ladder fitted with a safety cage / full hoops around the climb; cat = a plain cat ladder body only, no cage; trolley = a mobile step platform on castors',
  drawingNo: 'the Laddertech drawing number (starts LSB)',
  revision: 'string', customer: 'the company named in the Customer field', productName: 'the drawing TITLE line',
  material: 'string', finishing: 'string', date: 'string', workingLoad: 'string e.g. "150KG"',
  steps: 'integer', angle: 'string e.g. "60"',
  overallHeight: 'overall (tallest) vertical dimension, mm',
  platformLength: 'top platform length, mm — the horizontal dimension at the platform in the side elevation',
  overallWidth: 'overall width across the FRONT elevation, mm',
  footprint: 'overall base length along the floor in the side elevation, mm',
  floorToLanding: 'from the "Height : A + B" note, the FIRST (larger) number, mm',
  handrailHeight: 'from the "Height : A + B" note, the SECOND (smaller) number, mm',
  ladderWidth: 'ladder outside width (front elevation), mm',
};
const SYSTEM = `You read ladder shop drawings and return JSON {"fields":{<field>:value}}.
Use ONLY values present in the source; never invent or round. Read dimension callouts digit by digit.`;
const prompt = (mod, body = '') =>
  `Extract:\n${FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n')}\nReturn JSON.` +
  (body ? `\n\nTEXT CONTENT:\n${body}` : '');

async function llm(mod, payload) {
  try {
    const { text } = await callLLM({ system: SYSTEM, ...payload });
    const j = parseJSON(text);
    return j?.fields ?? j ?? {};
  } catch (e) {
    return { __error: e.message.slice(0, 100) };
  }
}

export function resolveCorpus(cwd) {
  return ['LSB-2607-003-RHC-R00.pdf', 'LSB-2607-004-FHL-R00.pdf', 'LSB-2609-007-FHL-R00.pdf']
    .map((f) => resolve(cwd, f)).filter(existsSync);
}

/**
 * Score each file. Methods: rules always; text/vision only with a key
 * (`vision: false` disables the vision pass entirely, e.g. CI).
 * Returns { results, totals, key } — totals[method] = [hits, n].
 */
export async function scoreFiles(files, { text = false, vision = true } = {}) {
  const cfg = llmConfig();
  const useLlm = cfg.hasKey;
  const methods = ['rules', ...(useLlm && text ? ['text'] : []), ...(useLlm && vision ? ['vision'] : []), 'merged'];
  const totals = Object.fromEntries(methods.map((k) => [k, [0, 0]]));
  const results = [];

  for (const file of files) {
    const mod = inferModule(file);
    if (!mod) continue;
    const truth = TRUTH[mod], fields = FIELDS[mod];

    const srcText = pdftotext(file);
    const rules = extractRules(srcText, mod);
    const llmText = useLlm && text ? await llm(mod, { text: prompt(mod, srcText) }) : null;
    const img = useLlm && vision ? pagePng(file, 200) : null;
    const llmVision = img ? await llm(mod, { text: prompt(mod), image: img }) : null;

    // Merge: rules win when present; vision fills gaps; text is last resort.
    const merged = {};
    for (const f of fields) merged[f] = (rules[f] ?? '') !== '' ? rules[f] : (llmVision?.[f] ?? llmText?.[f] ?? null);

    const rows = [];
    for (const f of fields) {
      const want = truth[f];
      const values = { rules: rules[f] ?? null, text: llmText?.[f] ?? null, vision: llmVision?.[f] ?? null, merged: merged[f] ?? null };
      const cells = {
        rules: cmp(rules[f], want),
        text: llmText ? cmp(llmText[f], want) : null,
        vision: llmVision ? cmp(llmVision[f], want) : null,
        merged: cmp(merged[f], want),
      };
      for (const k of methods) { totals[k][1]++; if (cells[k] === 'hit') totals[k][0]++; }
      rows.push({ field: f, truth: want, cells, values });
    }
    results.push({ file: basename(file), module: mod, rows });
  }

  // key is reported only when an LLM pass actually ran (rules-only runs must
  // report null even on machines that have a key configured)
  return { results, totals, key: useLlm && (text || vision) ? `${cfg.provider}/${cfg.model} ${maskKey(cfg.apiKey)}` : null };
}

function cmp(v, want) {
  if (v && v.__error) return 'error';
  if (v == null || v === '') return 'miss';
  return eq(v, want) ? 'hit' : 'wrong';
}
