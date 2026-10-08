// Scaffold a template (and its editor HTML) from any PDF — the missing "upload PDF" hop.
//
//   node src/eval/scaffold.mjs "LSB-2607-003-RHC-R00.pdf"
//
// Steps: convert (Inkscape) -> hide outline duplicates -> propose bindings from the
// drawing's own text -> write templates/<id>/template.json -> build the editor HTML.
// Conversion is native (Inkscape/poppler), which is why this lives in the CLI.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { textRuns, findRun, orderedLists } from '../templates/render.mjs';
import { parseQueryAll, coincidentOutlineIds, hideIds } from '../templates/authoring.mjs';
import { buildEditor } from './makeEditor.mjs';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape';   // container/VPS: resolve via PATH
const norm = (s) => String(s).replace(/\s+/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function locate(runs, value) {
  const t = norm(value);
  if (runs.some((r) => norm(r.text) === t)) return { mode: 'text', runs: 1 };
  const g = findRun(runs, value, 'group');
  if (g.length) return { mode: 'group', runs: g.length };
  return null;
}

function dimensionTokens(runs, pageH) {
  const out = [], seen = new Set();
  const TH = 12;
  // Conservative: only the drawing area. Recall for dims that sit low on the sheet
  // is handled by click-to-bind in the editor (widening this pulled in title-block noise).
  for (const list of orderedLists(runs)) {
    let acc = '', coord = null, firstY = 0;
    const flush = () => {
      if (acc && firstY < 0.72 * pageH && /^\d{3,6}(\.\d{1,2})?$/.test(acc) && !seen.has(acc)) { seen.add(acc); out.push(acc); }
      acc = ''; coord = null; firstY = 0;
    };
    for (const r of list) {
      const vertical = Math.abs(r.dir.b) > Math.abs(r.dir.a);
      const c = vertical ? r.y : r.x;
      const numeric = /^[0-9.,]+$/.test(norm(r.text));
      if (numeric && (coord === null || Math.abs(c - coord) <= TH)) {
        if (coord === null) firstY = r.y;
        acc += norm(r.text); coord = c;
      } else { flush(); if (numeric) { acc = norm(r.text); coord = c; firstY = r.y; } }
    }
    flush();
  }
  return out;
}

function propose(runs, pageH) {
  const props = [], used = new Set();
  const add = (id, label, value) => {
    if (!value || used.has(id) || used.has(norm(value))) return;
    const loc = locate(runs, value); if (!loc) return;
    props.push({ id, label, value, mode: loc.mode, runs: loc.runs }); used.add(id); used.add(norm(value));
  };
  const texts = [...new Set(runs.map((r) => r.text.trim()).filter(Boolean))];

  add('drawingNo', 'Drawing No.', texts.find((t) => /^LSB[-/][0-9A-Za-z/-]{6,}$/.test(t)));
  add('customer', 'Customer', texts.find((t) => /SDN\.?\s*BHD$/i.test(t) && !/LADDERTECH|LADDER\s*TECH|NEW\s*AGE|NAR\b/i.test(t)));
  add('workingLoad', 'Working Load', texts.find((t) => /^\d{2,3}\s?KG$/i.test(t)));
  add('productName', 'Title', texts.filter((t) => /^[A-Z][A-Z0-9 ,&()/.-]{15,}$/.test(t)).sort((a, b) => b.length - a.length)[0]);
  let i = 0;
  for (const d of dimensionTokens(runs, pageH)) { if (i >= 8) break; add(`dim${i + 1}`, `Dimension ${i + 1}`, d); i++; }
  return props;
}

/** A demo set of changed values so the "Sample changes" button works on any template. */
function makeSample(props) {
  const s = {};
  for (const p of props) {
    const v = String(p.value);
    if (/^[0-9.,]+$/.test(v)) {
      const n = parseFloat(v.replace(/,/g, ''));
      if (!Number.isNaN(n)) s[p.id] = (n * 1.1).toFixed(v.includes('.') ? 2 : 0);
    } else if (p.id === 'customer') s[p.id] = 'ACME TOWER CRANES SDN BHD';
    else if (p.id === 'drawingNo') s[p.id] = v.replace(/R\d{2}$/, 'R99').replace(/\d{2}$/, '99');
    else if (p.id === 'workingLoad') s[p.id] = '200KG';
    else if (p.id === 'productName') s[p.id] = v + ' - REV B';
  }
  return s;
}

export function scaffold(pdf, opts = {}) {
  const file = resolve(pdf);
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const id = opts.id || slug(basename(file).replace(/\.pdf$/i, ''));
  const dir = resolve('templates', id);
  mkdirSync(dir, { recursive: true });

  // 1. convert (Inkscape keeps text; needed for binding)
  const raw = join(dir, 'base.svg');
  try {
    execFileSync(INK, ['--export-type=svg', `--export-filename=${raw}`, file], { stdio: 'pipe' });
  } catch (e) {
    const sig = e.signal ? ` (signal ${e.signal})` : '';
    const why = e.code === 'ENOENT' ? 'inkscape not found on PATH'
      : String(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ').slice(0, 200);
    throw new Error(`conversion failed${sig} — ${why}`);
  }
  if (!existsSync(raw)) throw new Error('conversion produced no SVG');

  // 2. hide coincident outline duplicates
  const base = readFileSync(raw, 'utf8');
  const rows = parseQueryAll(execFileSync(INK, ['--query-all', raw], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const dup = coincidentOutlineIds(rows);
  const clean = hideIds(base, dup);
  writeFileSync(join(dir, 'base.clean.svg'), clean);

  // 3. propose bindings
  const runs = textRuns(clean);
  const pageH = Number((clean.match(/<svg[^>]*\bheight="([\d.]+)"/) || [])[1]) || Math.max(...runs.map((r) => r.y), 1);
  const props = propose(runs, pageH);
  const tpl = {
    id,
    name: props.find((p) => p.id === 'productName')?.value || basename(file),
    source: opts.sourceName || basename(file),
    match: {},
    base: { svg: 'base.clean.svg' },
    params: props.map((p) => ({ id: p.id, label: p.label, type: 'text', default: p.value })),
    bindings: props.map((p) => ({ value: p.value, param: p.id, mode: p.mode })),
    sample: makeSample(props),
  };
  writeFileSync(join(dir, 'template.json'), JSON.stringify(tpl, null, 2) + '\n');

  // 4. editor
  const ed = buildEditor(dir);

  return { id, dir, outlines: dup.length, props, editor: ed.out, editorMB: (ed.bytes / 1e6).toFixed(1) };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('scaffold.mjs')) {
  const pdf = process.argv[2];
  if (!pdf) { console.error('usage: node src/eval/scaffold.mjs <file.pdf>'); process.exit(1); }
  try {
    const r = scaffold(pdf);
    console.log(`scaffolded: ${r.id}`);
    console.log(`  folder    : ${r.dir}`);
    console.log(`  outlines  : ${r.outlines} duplicate(s) hidden`);
    console.log(`  proposed  : ${r.props.length} binding(s)`);
    for (const p of r.props) console.log(`     ${p.id.padEnd(12)} ${p.mode.padEnd(6)} ${JSON.stringify(p.value)}`);
    console.log(`  editor    : ${r.editor}  (${r.editorMB} MB)`);
  } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
