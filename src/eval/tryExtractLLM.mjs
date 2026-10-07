// A/B probe: ask the LLM to extract fields from PDF drawings,
// in TEXT mode (pdftotext) and VISION mode (rendered page PNG),
// scored against known-good values per module.
//
//   node src/eval/tryExtractLLM.mjs                 # all three corpus PDFs
//   node src/eval/tryExtractLLM.mjs FILE.pdf ...    # specific files
//
// First look only (PLAN.md §1B); the full `ladder eval` will formalise this.

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig, maskKey } from '../config/env.mjs';

const COMMON = {
  productType: 'one of: trolley | cat | cage',
  productName: 'string (the drawing TITLE line)',
  drawingNo: 'string (the Laddertech drawing number, format LSB-... or LSB/...)',
  revision: 'string',
  customer: 'string (the field labelled Customer)',
  material: 'string',
  finishing: 'string',
  date: 'string',
  workingLoad: 'string (e.g. "150KG")',
  unit: 'string',
};

const MODULES = {
  trolley: {
    schema: { ...COMMON, steps: 'integer', angle: 'string', overallHeight: 'number, mm',
              platformLength: 'number, mm', overallWidth: 'number, mm', footprint: 'number, mm' },
    truth: {
      productType: 'trolley', drawingNo: 'LSB-2607-003-RHC-R00', revision: '00',
      customer: 'RAHABCO ENGINEERING & CONSTRUCTION SDN BHD',
      productName: 'ALUMINIUM SAFETY LADDER TROLLEY 9 STEP (CUSTOMIZED)',
      steps: 9, angle: '60', overallHeight: 3500, workingLoad: '150KG',
      platformLength: 980, overallWidth: 700, footprint: 2372, material: 'Aluminium', finishing: 'MF',
    },
  },
  cage: {
    schema: { ...COMMON, floorToLanding: 'number, mm', handrailHeight: 'number, mm', ladderWidth: 'number, mm' },
    truth: {
      productType: 'cage', drawingNo: 'LSB/2607/004/FHL/R00', revision: '00',
      customer: 'FHL CONSTRUCTION SDN BHD', material: 'Aluminium', finishing: 'MF', workingLoad: '150KG',
      floorToLanding: 6650, handrailHeight: 900, ladderWidth: 450,
    },
  },
  cat: {
    schema: { ...COMMON, overallHeight: 'number, mm' },
    truth: {
      productType: 'cat', drawingNo: 'LSB/2609/007/FHL/R00', revision: '00',
      customer: 'FHL CONSTRUCTION SDN BHD', productName: 'ALUMINIUM CAT LADDER BODY TYPE',
      material: 'Aluminium', finishing: 'MF', workingLoad: '150KG', date: '07-09-2026', overallHeight: 3210,
    },
  },
};

const SYSTEM = `You read aluminium ladder / scaffolding shop drawings and return structured data.
Use ONLY values that appear in the source. Use null for anything not present. Do not guess dimensions.
Angles and loads keep the printed form (e.g. "60", "150KG"). Lengths are millimetres as integers.
Return JSON: {"fields":{<field>: value}, "confidence":{<field>: 0..1}, "notes":["..."]}`;

const inferModule = (f) =>
  /2607-003|RHC/.test(f) ? 'trolley' : /2607-004/.test(f) ? 'cage' : /2609-007/.test(f) ? 'cat' : null;
const pick = (obj, k) => (obj?.fields?.[k] ?? obj?.[k]);
const norm = (v) => (v == null ? '' : String(v).toLowerCase().replace(/[\s,]/g, ''));

function userText(mod, body) {
  return `Extract these fields from the drawing:\n${Object.entries(MODULES[mod].schema)
    .map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n--- DRAWING CONTENT ---\n${body}`;
}
function pdftotext(f) { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
function pagePng(f, dpi = 150) {
  const dir = mkdtempSync(join(tmpdir(), 'ladder-'));
  const out = join(dir, 'page');
  execFileSync('pdftocairo', ['-png', '-r', String(dpi), '-singlefile', f, out]);
  const buf = readFileSync(out + '.png');
  return { base64: buf.toString('base64'), mimeType: 'image/png', bytes: buf.length };
}
function score(mod, got) {
  const truth = MODULES[mod].truth;
  let hit = 0; const rows = [];
  for (const [k, want] of Object.entries(truth)) {
    const g = pick(got, k);
    const ok = norm(g) === norm(want) || (typeof want === 'number' && Number(g) === want);
    if (ok) hit++;
    rows.push(`${ok ? '✓' : '✗'} ${k.padEnd(14)} want=${JSON.stringify(want).padEnd(46)} got=${JSON.stringify(g ?? null)}`);
  }
  return { hit, total: Object.keys(truth).length, rows };
}
async function run(label, mod, payload) {
  const t0 = Date.now();
  try {
    const { text, usage } = await callLLM({ system: SYSTEM, ...payload });
    const ms = Date.now() - t0;
    const { hit, total, rows } = score(mod, parseJSON(text));
    console.log(`  ${label.padEnd(12)} ${String(hit).padStart(2)}/${total}  ${ms} ms  tok=${usage?.totalTokenCount ?? '?'}`);
    for (const r of rows) if (r.startsWith('✗')) console.log('       ' + r);
  } catch (e) {
    console.log(`  ${label.padEnd(12)} FAILED  ${e.message.slice(0, 160)}`);
  }
}

const cfg = llmConfig();
console.log(`provider ${cfg.provider} (${cfg.providerAlias})  model=${cfg.model}  key=${maskKey(cfg.apiKey)} via ${cfg.keyVar}\n`);

const files = (process.argv.slice(2).length ? process.argv.slice(2) : [
  'LSB-2607-003-RHC-R00.pdf', 'LSB-2607-004-FHL-R00.pdf', 'LSB-2609-007-FHL-R00.pdf',
]).map((f) => resolve(f)).filter(existsSync);

for (const f of files) {
  const mod = inferModule(basename(f));
  if (!mod) { console.log(`${basename(f)}: unknown module, skipped`); continue; }
  console.log(`### ${basename(f)}  [${mod}]`);
  const text = pdftotext(f);
  await run('TEXT', mod, { text: userText(mod, text) });
  const img = pagePng(f);
  await run('VISION', mod, { text: userText(mod, '(see attached image)'), image: img });
  console.log('');
}
