// A/B eval: rules vs LLM-text vs LLM-vision vs MERGED (rules-first), per field.
//
//   node src/eval/eval.mjs                # all three PDFs
//   node src/eval/eval.mjs FILE.pdf ...   # specific files

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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

const cell = (v, want) => {
  if (v && v.__error) return 'ERR';
  if (v == null || v === '') return '✗ —';
  return eq(v, want) ? '✓' : `✗ ${String(v).slice(0, 16)}`;
};
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n);

const cfg = llmConfig();
console.log(`provider ${cfg.provider} (${cfg.providerAlias})  model=${cfg.model}  key=${maskKey(cfg.apiKey)} via ${cfg.keyVar}\n`);

const files = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['LSB-2607-003-RHC-R00.pdf', 'LSB-2607-004-FHL-R00.pdf', 'LSB-2609-007-FHL-R00.pdf'])
  .map((f) => resolve(f)).filter(existsSync);

const methods = ['rules', 'text', 'vision', 'merged'];
const totals = Object.fromEntries(methods.map((k) => [k, [0, 0]]));

for (const file of files) {
  const mod = inferModule(file);
  if (!mod) continue;
  const truth = TRUTH[mod], fields = FIELDS[mod];

  const text = pdftotext(file);
  const img = pagePng(file, 200);
  const rules = extractRules(text, mod);
  const llmText = await llm(mod, { text: prompt(mod, text) });
  const llmVision = await llm(mod, { text: prompt(mod), image: img });

  // Merge: rules win when present; vision fills gaps; text is last resort.
  const merged = {};
  for (const f of fields) merged[f] = (rules[f] ?? '') !== '' ? rules[f] : (llmVision[f] ?? llmText[f] ?? null);

  console.log(`### ${basename(file)}  [${mod}]   (vision ${(img.bytes / 1024).toFixed(0)} KB @200dpi)`);
  console.log(`  ${pad('field', 16)}${pad('truth', 32)}${pad('rules', 18)}${pad('text', 18)}${pad('vision', 18)}merged`);
  for (const f of fields) {
    const want = truth[f];
    const cells = {
      rules: cell(rules[f], want), text: cell(llmText[f], want),
      vision: cell(llmVision[f], want), merged: cell(merged[f], want),
    };
    for (const k of methods) { totals[k][1]++; if (cells[k].startsWith('✓')) totals[k][0]++; }
    console.log(`  ${pad(f, 16)}${pad(JSON.stringify(want), 32)}${pad(cells.rules, 18)}${pad(cells.text, 18)}${pad(cells.vision, 18)}${cells.merged}`);
  }
  console.log('');
}

console.log('TOTAL SCORE');
for (const k of methods) {
  const [hit, n] = totals[k];
  console.log(`  ${pad(k, 8)} ${lpad(hit, 3)}/${n}  (${Math.round((hit / n) * 100)}%)`);
}
