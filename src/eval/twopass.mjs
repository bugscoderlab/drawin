// Does a second LLM call help? Both passes see the WHOLE page image.
//
//   node src/eval/twopass.mjs
//
// Compares, per field:
//   read1  - one vision pass (baseline)
//   verify - pass 2 that re-checks read1 against the same full image
//   read2  - an independent second read (temperature 0.7)
//   cons   - consensus of read1/read2 (read1 when they agree, else flagged/read1)
//   verify+cons - verify when it exists, else consensus

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pdftotext, pagePng, inferModule } from './pdf.mjs';
import { TRUTH, FIELDS, eq } from './truth.mjs';
import { extractRules } from '../extract/rules.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig, maskKey } from '../config/env.mjs';

const DESC = {
  productType: 'one of trolley|cat|cage (cage = has a safety cage/rings; cat = plain body; trolley = mobile platform on castors)',
  drawingNo: 'Laddertech drawing number (starts LSB)', revision: 'string',
  customer: 'company in the Customer field', productName: 'the TITLE line',
  material: 'string', finishing: 'string', date: 'string', workingLoad: 'string e.g. "150KG"',
  steps: 'integer', angle: 'string e.g. "60"',
  overallHeight: 'overall (tallest) vertical dimension, mm',
  platformLength: 'top platform length mm', overallWidth: 'overall width across the FRONT elevation mm',
  footprint: 'overall base length along the floor in the side elevation mm',
  floorToLanding: 'from "Height : A + B", the FIRST (larger) number mm',
  handrailHeight: 'from "Height : A + B", the SECOND (smaller) number mm',
  ladderWidth: 'ladder outside width mm',
};
const SYS = `You read ladder shop drawings and return structured data as JSON.
Use ONLY values present in the source; null when absent; never invent or round dimensions.
Dimension callouts are small — read every digit carefully.
Return {"fields":{<field>:value},"confidence":{<field>:0..1}}`;

const ask = (mod, body) => `Extract these fields:\n${FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n')}\n\n--- CONTENT ---\n${body}`;
const verifyPrompt = (mod, prev) =>
  `You previously extracted the JSON below from THIS drawing. Re-examine the full drawing image and correct anything wrong or missing.\n` +
  `Pay special attention to small dimension callouts — distinguish e.g. 3200 vs 3210, 700 vs 980. Keep values that are already correct.\n` +
  `Fields: ${FIELDS[mod].join(', ')}\n\nPREVIOUS:\n${JSON.stringify(prev)}\n\nReturn the full corrected JSON in the same shape.`;

async function vision(mod, promptText, image, temperature = 0) {
  try {
    const { text } = await callLLM({ system: SYS, text: promptText, image, temperature });
    const j = parseJSON(text);
    return j?.fields ?? j ?? {};
  } catch (e) { return { __error: e.message.slice(0, 80) }; }
}

const cell = (v, want) => (v == null || v === '' ? '✗ —' : eq(v, want) ? '✓' : `✗ ${String(v).slice(0, 14)}`);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n);

const cfg = llmConfig();
console.log(`provider ${cfg.provider} model=${cfg.model} key=${maskKey(cfg.apiKey)}\n`);

const files = (process.argv.slice(2).length ? process.argv.slice(2)
  : ['LSB-2607-003-RHC-R00.pdf', 'LSB-2607-004-FHL-R00.pdf', 'LSB-2609-007-FHL-R00.pdf'])
  .map((f) => resolve(f)).filter(existsSync);

const methods = ['rules', 'read1', 'verify', 'read2', 'cons', 'v+c'];
const totals = Object.fromEntries(methods.map((k) => [k, [0, 0]]));

for (const file of files) {
  const mod = inferModule(file); if (!mod) continue;
  const truth = TRUTH[mod], fields = FIELDS[mod];
  const text = pdftotext(file);
  const img = pagePng(file, 200);

  const rules = extractRules(text, mod);
  const read1 = await vision(mod, ask(mod, '(see attached image)'), img, 0);
  const read2 = await vision(mod, ask(mod, '(see attached image)'), img, 0.7);
  const verify = await vision(mod, verifyPrompt(mod, read1), img, 0);

  const cons = {}; let agree = 0;
  for (const f of fields) {
    if (String(read1[f] ?? '') === String(read2[f] ?? '')) { cons[f] = read1[f]; agree++; }
    else cons[f] = read1[f];
  }
  const vc = {};
  for (const f of fields) vc[f] = (verify[f] ?? '') !== '' ? verify[f] : cons[f];
  // fill remaining blanks from rules
  for (const f of fields) if ((vc[f] ?? '') === '' ) vc[f] = rules[f] ?? null;

  console.log(`### ${basename(file)} [${mod}]  read1/read2 agreement ${agree}/${fields.length}`);
  console.log(`  ${pad('field', 16)}${pad('truth', 30)}${pad('rules', 16)}${pad('read1', 16)}${pad('verify', 16)}${pad('read2', 16)}${pad('cons', 16)}v+c`);
  const row = (f) => {
    const want = truth[f];
    const m = { rules: cell(rules[f], want), read1: cell(read1[f], want), verify: cell(verify[f], want), read2: cell(read2[f], want), cons: cell(cons[f], want), 'v+c': cell(vc[f], want) };
    for (const k of methods) { totals[k][1]++; if (m[k].startsWith('✓')) totals[k][0]++; }
    console.log(`  ${pad(f, 16)}${pad(JSON.stringify(want), 30)}${pad(m.rules, 16)}${pad(m.read1, 16)}${pad(m.verify, 16)}${pad(m.read2, 16)}${pad(m.cons, 16)}${m['v+c']}`);
  };
  fields.forEach(row);
  console.log('');
}

console.log('TOTAL SCORE');
for (const k of methods) { const [h, n] = totals[k]; console.log(`  ${pad(k, 7)} ${lpad(h, 3)}/${n}  (${Math.round((h / n) * 100)}%)`); }
