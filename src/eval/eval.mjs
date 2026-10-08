// A/B eval table (developer view) — thin wrapper over src/eval/scoreboard.mjs.
//
//   node src/eval/eval.mjs                # all three PDFs
//   node src/eval/eval.mjs FILE.pdf ...   # specific files

import { basename } from 'node:path';
import { scoreFiles, resolveCorpus } from './scoreboard.mjs';

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

const files = process.argv.slice(2).length ? process.argv.slice(2) : resolveCorpus(process.cwd());
const { results, totals, key } = await scoreFiles(files, { text: true, vision: true });

console.log(`llm: ${key ?? 'NO KEY — rules-only (set LADDER_LLM_* in .env for vision)'}\n`);

const cell = (c, v) => c === 'hit' ? '✓' : c === 'miss' ? '✗ —' : c === 'error' ? 'ERR' : c == null ? '·' : `✗ ${String(v ?? '').slice(0, 16)}`;
for (const r of results) {
  console.log(`### ${r.file}  [${r.module}]`);
  console.log(`  ${pad('field', 16)}${pad('truth', 32)}${pad('rules', 18)}${pad('text', 18)}${pad('vision', 18)}merged`);
  for (const row of r.rows) {
    console.log(`  ${pad(row.field, 16)}${pad(JSON.stringify(row.truth), 32)}${pad(cell(row.cells.rules, row.values.rules), 18)}${pad(cell(row.cells.text, row.values.text), 18)}${pad(cell(row.cells.vision, row.values.vision), 18)}${cell(row.cells.merged, row.values.merged)}`);
  }
  console.log('');
}

console.log('TOTAL SCORE');
for (const [k, [hit, n]] of Object.entries(totals)) {
  console.log(`  ${pad(k, 8)} ${lpad(hit, 3)}/${n}  (${Math.round((hit / n) * 100)}%)`);
}
