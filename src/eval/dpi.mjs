// Resolution probe: does the stuck field (cat overallHeight = 3210) recover
// at higher DPI? FULL page every time (no cropping).
//
//   node src/eval/dpi.mjs [FILE.pdf] [dpi,dpi,...]

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pagePng, inferModule } from './pdf.mjs';
import { TRUTH, FIELDS, eq } from './truth.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig, maskKey } from '../config/env.mjs';

const DESC = {
  productType: 'one of trolley|cat|cage', drawingNo: 'string (starts LSB)', revision: 'string',
  customer: 'string', productName: 'the TITLE line', material: 'string', finishing: 'string',
  date: 'string', workingLoad: 'string e.g. "150KG"', steps: 'integer', angle: 'string',
  overallHeight: 'overall (tallest) vertical dimension, mm',
  floorToLanding: 'from "Height : A + B", the FIRST (larger) number mm',
  handrailHeight: 'from "Height : A + B", the SECOND (smaller) number mm', ladderWidth: 'mm',
};
const SYS = `You read ladder shop drawings and return JSON {"fields":{<field>:value}}.
Use ONLY values present in the source; never invent or round. Read dimension callouts digit by digit.`;
const ask = (mod) => `Extract:\n${FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n')}\nReturn JSON.`;

const cfg = llmConfig();
console.log(`provider ${cfg.provider} model=${cfg.model} key=${maskKey(cfg.apiKey)}\n`);

const file = resolve(process.argv[2] || 'LSB-2609-007-FHL-R00.pdf');
const dpis = (process.argv[3] || '150,200,300,400').split(',').map(Number);
if (!existsSync(file)) throw new Error('missing ' + file);
const mod = inferModule(file);
const truth = TRUTH[mod];

for (const dpi of dpis) {
  const img = pagePng(file, dpi);
  let fields = {}, err = null;
  const t0 = Date.now();
  try {
    const { text } = await callLLM({ system: SYS, text: ask(mod), image: img });
    const j = parseJSON(text); fields = j?.fields ?? j ?? {};
  } catch (e) { err = e.message.slice(0, 90); }
  const ms = Date.now() - t0;
  const hit = FIELDS[mod].filter((f) => eq(fields[f], truth[f])).length;
  console.log(`${String(dpi).padStart(3)} dpi  img=${(img.bytes / 1024).toFixed(0)} KB  ${ms} ms  score=${hit}/${FIELDS[mod].length}  overallHeight=${JSON.stringify(fields.overallHeight ?? null)}${err ? '  ERR ' + err : ''}`);
}
console.log(`\ntruth overallHeight = ${truth.overallHeight}`);
