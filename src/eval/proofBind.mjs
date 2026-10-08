// Proof of "bind, don't redraw", per template.
//
//   node src/eval/proofBind.mjs <templateDir>
//   node src/eval/proofBind.mjs templates/trolley-slt
//
//   PDF -> converted art (Inkscape, keeps text) -> hide outline duplicates
//       -> substitute bound values -> faithful drawing with edited data.
//
// Outputs to preview/<templateId>/:
//   0_COMPARE.png (if a PIL python is available)  1_BEFORE_original.pdf.png
//   2_BEFORE_base.png  3_AFTER_changed.png/.svg

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { renderTemplate } from '../templates/render.mjs';
import { parseQueryAll, coincidentOutlineIds, hideIds } from '../templates/authoring.mjs';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape';   // container/VPS: resolve via PATH
const tplDir = resolve(process.argv[2] || 'templates/trolley-slt');
const tpl = JSON.parse(readFileSync(join(tplDir, 'template.json'), 'utf8'));
const OUT = resolve('preview', tpl.id);
mkdirSync(OUT, { recursive: true });

const base = readFileSync(join(tplDir, 'base.svg'), 'utf8');

// 1. Hide coincident outline duplicates.
const rows = parseQueryAll(execFileSync(INK, ['--query-all', join(tplDir, 'base.svg')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const dupIds = coincidentOutlineIds(rows);
const clean = hideIds(base, dupIds);
writeFileSync(join(tplDir, 'base.clean.svg'), clean);

// 2. Bind.
const original = Object.fromEntries(tpl.params.map((p) => [p.id, p.default]));
const before = renderTemplate(clean, tpl.bindings, original);
const after = renderTemplate(clean, tpl.bindings, tpl.sample);
writeFileSync(join(OUT, '2_BEFORE_base.svg'), clean);
writeFileSync(join(OUT, '3_AFTER_changed.svg'), after.svg);

// 3. Rasterise.
const render = (svg, png, w = 1500) =>
  execFileSync(INK, ['--export-type=png', `--export-filename=${png}`, '-w', String(w), svg]);
render(join(OUT, '2_BEFORE_base.svg'), join(OUT, '2_BEFORE_base.png'));
render(join(OUT, '3_AFTER_changed.svg'), join(OUT, '3_AFTER_changed.png'));
execFileSync('pdftocairo', ['-png', '-r', '150', '-singlefile', resolve(tpl.source), join(OUT, '1_BEFORE_original')]);

console.log(`template : ${tpl.id}   (${tpl.source})`);
console.log(`outlines : ${dupIds.length} duplicate(s) hidden  (${base.length} -> ${clean.length} bytes)`);
console.log(`unchanged: original render === cleaned base  ->  ${before.svg === clean}`);
console.log('bindings (after):');
for (const r of after.report) {
  console.log('  ' + (r.ok
    ? (r.ratio !== undefined
      ? `OK    ${r.param.padEnd(13)} geom ${r.geom.op}  x${r.ratio}`
      : `OK    ${r.param.padEnd(13)} ${r.runs} run(s)   ${JSON.stringify(r.from).slice(0, 44)}  ->  ${JSON.stringify(r.to)}`)
    : `FAIL  ${r.param.padEnd(13)} ${r.reason}`));
}
console.log(`\nwrote ${OUT}`);
