// End-to-end preview: PDF -> extract (rules + one vision pass, merged) -> generator SVG.
// No HTML changes; writes a standalone SVG and a PNG render.
//
//   node src/eval/preview.mjs LSB-2607-003-RHC-R00.pdf
//   node src/eval/preview.mjs LSB-2607-004-FHL-R00.pdf

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pdftotext, pagePng, inferModule } from './pdf.mjs';
import { FIELDS } from './truth.mjs';
import { extractRules } from '../extract/rules.mjs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { paramsFor } from '../core/modules.mjs';
import { renderDocument, renderSVG } from '../core/render.mjs';

const OUT = '/private/var/folders/89/lbrz89_569g681v9jnpmrf1m0000gn/T/opencode/ladder/preview';
mkdirSync(OUT, { recursive: true });

const DESC = {
  productType: 'one of trolley|cat|cage', drawingNo: 'string (starts LSB)', revision: 'string',
  customer: 'the Customer field', productName: 'the TITLE line', material: 'string', finishing: 'string',
  date: 'string', workingLoad: 'string e.g. "150KG"', steps: 'integer', angle: 'string e.g. "60"',
  overallHeight: 'overall tallest vertical dimension mm', platformLength: 'top platform length mm',
  overallWidth: 'overall width across the FRONT elevation mm', footprint: 'base length along the floor mm',
  floorToLanding: 'from "Height : A + B", the FIRST (larger) number mm',
  handrailHeight: 'from "Height : A + B", the SECOND (smaller) number mm', ladderWidth: 'ladder width mm',
};
const SYS = `You read ladder shop drawings and return JSON {"fields":{<field>:value}}.
Use ONLY values present in the source; never invent or round. Read dimension callouts digit by digit.`;
const ask = (mod) => `Extract:\n${FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n')}\nReturn JSON.`;

const set = (o, k, v) => { if (v !== undefined && v !== null && v !== '') o[k] = v; };
function mapTrolley(e) {
  const o = {};
  set(o, 'customer', e.customer); set(o, 'drawingNo', e.drawingNo); set(o, 'revision', e.revision);
  set(o, 'material', e.material); set(o, 'finish', e.finishing); set(o, 'steps', e.steps);
  set(o, 'platformLength', e.platformLength); set(o, 'trolleyWidth', e.overallWidth); set(o, 'footprint', e.footprint);
  set(o, 'load', e.workingLoad);
  if (e.angle != null) o.angle = String(e.angle).includes('°') ? String(e.angle) : `${e.angle}°`;
  return o;
}
function mapCage(e) {
  const o = {};
  set(o, 'customer', e.customer); set(o, 'drawingNo', e.drawingNo); set(o, 'revision', e.revision);
  set(o, 'material', e.material); set(o, 'finish', e.finishing);
  set(o, 'cageLadderHeight', e.floorToLanding); set(o, 'cageHandrailHeight', e.handrailHeight);
  set(o, 'cageWidth', e.ladderWidth); set(o, 'cageLoad', e.workingLoad);
  return o;
}

const file = resolve(process.argv[2] || 'LSB-2607-003-RHC-R00.pdf');
const mod = inferModule(file);
const text = pdftotext(file);
const img = pagePng(file, 200);
const rules = extractRules(text, mod);
let vision = {};
try {
  const { text: t } = await callLLM({ system: SYS, text: ask(mod), image: img });
  const j = parseJSON(t); vision = j?.fields ?? j ?? {};
} catch (e) { console.log('vision failed:', e.message.slice(0, 120)); }

const merged = {};
for (const f of FIELDS[mod]) merged[f] = (rules[f] ?? '') !== '' ? rules[f] : (vision[f] ?? null);

const overrides = mod === 'trolley' ? mapTrolley(merged) : mapCage(merged);
const params = paramsFor(mod, overrides);

const base = basename(file).replace(/\.pdf$/i, '');
const svgPath = `${OUT}/${base}.gen.svg`;
const doc = renderDocument(mod, params, { date: '07-10-2026' });
if (doc.error) { console.log('render error:', doc.error); process.exit(1); }
writeFileSync(svgPath, doc.document);
execFileSync('rsvg-convert', ['-w', '1100', '-o', `${OUT}/${base}.gen.png`, svgPath]);
execFileSync('pdftocairo', ['-png', '-r', '120', '-singlefile', file, `${OUT}/${base}.pdf`]);

console.log(`module   : ${mod}`);
console.log(`readouts : ${JSON.stringify(doc.readouts)}`);
console.log(`fields   : ${JSON.stringify(merged)}`);
console.log(`params   : ${JSON.stringify(overrides)}`);
console.log(`svg      : ${svgPath}`);
console.log(`gen png  : ${OUT}/${base}.gen.png`);
console.log(`pdf png  : ${OUT}/${base}.pdf.png`);
