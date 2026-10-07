// Isolate which part of the prompt makes vision drop cat overallHeight.
// Tests 2 SYSTEM prompts x 2 ask-tails against the same image.
import { pagePng, inferModule } from './pdf.mjs';
import { FIELDS } from './truth.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { resolve } from 'node:path';

const DESC = {
  productType: 'one of trolley|cat|cage. cage = a ladder fitted with a safety cage / full hoops around the climb; cat = a plain cat ladder body only, no cage; trolley = a mobile step platform on castors',
  drawingNo: 'the Laddertech drawing number (starts LSB)', revision: 'string', customer: 'string',
  productName: 'the drawing TITLE line', material: 'string', finishing: 'string', date: 'string',
  workingLoad: 'string e.g. "150KG"', overallHeight: 'overall (tallest) vertical dimension, mm',
};
const fieldLines = (mod) => FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n');

const SYS_A = `You read aluminium ladder / scaffolding shop drawings and return structured data.
Use ONLY values that appear in the source; null when absent; never invent or round dimensions.
Dimension callouts may be small or broken across characters — read every digit carefully.
Return JSON: {"fields":{<field>: value}, "confidence":{<field>: 0..1}}`;
const SYS_B = `You read ladder shop drawings and return JSON {"fields":{<field>:value}}.
Use ONLY values present in the source; never invent or round. Read dimension callouts digit by digit.`;

const askA = (mod) => `Extract these fields:\n${fieldLines(mod)}\n\n--- CONTENT ---\n(see attached image)`;
const askB = (mod) => `Extract:\n${fieldLines(mod)}\nReturn JSON.`;

const file = resolve(process.argv[2] || 'LSB-2609-007-FHL-R00.pdf');
const mod = inferModule(file);
const img = pagePng(file, 200);

for (const [name, sys, ask] of [
  ['A_sys + A_ask (current eval)', SYS_A, askA],
  ['B_sys + A_ask', SYS_B, askA],
  ['A_sys + B_ask', SYS_A, askB],
  ['B_sys + B_ask (dpi probe)', SYS_B, askB],
]) {
  try {
    const { text } = await callLLM({ system: sys, text: ask(mod), image: img });
    const j = parseJSON(text);
    const f = j?.fields ?? j ?? {};
    console.log(`${name.padEnd(30)} overallHeight=${JSON.stringify(f.overallHeight ?? null)}`);
  } catch (e) { console.log(`${name.padEnd(30)} ERR ${e.message.slice(0, 60)}`); }
}
