// Vision dimension recovery (docs/plans/vision-dimension-recovery.md):
// zero-dims outline PDFs -> vision proposes {value, x_pct, y_pct} per dim ->
// outline glyph cluster is replaced by a synthesized <text> node -> text and
// geometry bindings run unchanged. The px/mm plausibility gate drops (and
// reports) hallucinated values. The LLM is injectable, so tests need no key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findOutlineCluster, synthesizeDimText, recoverVisionDims } from '../src/eval/vision.mjs';
import { scaffold, reportScaffold } from '../src/eval/scaffold.mjs';
import { textRuns } from '../src/templates/render.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- findOutlineCluster ----------

// 4 outlined glyphs of a horizontal number + a thin dim-line stub running
// through the text (must NOT count as a glyph) + an unrelated glyph far away.
const outlineRows = [
  { id: 'path1', x: 100, y: 100, w: 7, h: 9 },
  { id: 'path2', x: 108, y: 100, w: 7, h: 9 },
  { id: 'path3', x: 116, y: 100, w: 7, h: 9 },
  { id: 'path4', x: 124, y: 100, w: 7, h: 9 },
  { id: 'path5', x: 96, y: 103, w: 40, h: 0.8 },  // long-thin stub: aspect 50
  { id: 'path6', x: 200, y: 300, w: 6, h: 8 },     // outside the near radius
];

test('findOutlineCluster: nearest glyph cluster, thin line stubs excluded', () => {
  const cl = findOutlineCluster(outlineRows, 118, 104);
  assert.deepEqual(new Set(cl.ids), new Set(['path1', 'path2', 'path3', 'path4']));
  assert.deepEqual(cl.bbox, { x0: 100, y0: 100, x1: 131, y1: 109 });
});

test('findOutlineCluster: null when no glyph path is near the position', () => {
  assert.equal(findOutlineCluster(outlineRows, 400, 400), null);
  assert.equal(findOutlineCluster([], 100, 100), null);
});

test('findOutlineCluster: a tall cluster reads as vertical (rotated number)', () => {
  const tall = [
    { id: 'path1', x: 100, y: 200, w: 9, h: 7 },
    { id: 'path2', x: 100, y: 208, w: 9, h: 7 },
    { id: 'path3', x: 100, y: 216, w: 9, h: 7 },
  ];
  const cl = findOutlineCluster(tall, 104, 211);
  assert.equal(cl.ids.length, 3);
  assert.equal(cl.bbox.y1 - cl.bbox.y0, 23);
});

// ---------- synthesizeDimText ----------

const art = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="p1" d="M 0,0 h 7 v 9 h -7 z" transform="matrix(1,0,0,1,100,100)"/>'
  + '<path id="p2" d="M 0,0 h 7 v 9 h -7 z" transform="matrix(1,0,0,1,108,100)"/>'
  + '<path id="other" d="M 0,0 h 50 v 50 h -50 z"/>'
  + '</svg>';

test('synthesizeDimText: cluster replaced by a <text> node at the bbox', () => {
  const r = synthesizeDimText(art, { ids: ['p1', 'p2'], bbox: { x0: 100, y0: 100, x1: 115, y1: 109 } }, '3200', 'vision1');
  assert.equal(r.vertical, false);
  assert.ok(!r.svg.includes('id="p1"') && !r.svg.includes('id="p2"'), 'outline paths removed');
  assert.ok(r.svg.includes('id="other"'), 'unrelated art untouched');
  const [run] = textRuns(r.svg).filter((x) => x.text === '3200');
  assert.ok(run, 'synthesized text is a findable run');
  assert.equal(run.id, 'vision1');
  assert.ok(Math.abs(run.x - 100) < 0.01 && Math.abs(run.y - 109) < 0.01, 'position from the cluster bbox');
});

test('synthesizeDimText: tall cluster becomes a bottom-to-top rotated run', () => {
  const r = synthesizeDimText(art, { ids: ['p1'], bbox: { x0: 100, y0: 100, x1: 109, y1: 123 } }, '295', 'vision2');
  assert.equal(r.vertical, true);
  const [run] = textRuns(r.svg).filter((x) => x.text === '295');
  assert.ok(run, 'rotated run exists');
  assert.ok(Math.abs(run.x - 104.5) < 0.01 && Math.abs(run.y - 111.5) < 0.01, 'rotation origin at the bbox centre');
  assert.ok(Math.abs(run.dir.b) > Math.abs(run.dir.a), 'reads vertically');
});

// ---------- recoverVisionDims (injectable call, no key needed) ----------

const fakeLLM = (reply, calls = []) => {
  const fn = async (req) => { calls.push(req); return { text: typeof reply === 'function' ? reply(req) : reply }; };
  fn.calls = calls;
  return fn;
};

const vRows = [
  { id: 'path1', x: 396, y: 296, w: 8, h: 8 },   // cluster near (50%, 25%) of 800x1200
  { id: 'path2', x: 405, y: 296, w: 8, h: 8 },
  { id: 'path3', x: 700, y: 900, w: 400, h: 3 }, // a long line, not a glyph
];
const vSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">'
  + '<path id="path1" d="M 0,0 h 8 v 8 h -8 z"/>'
  + '<path id="path2" d="M 0,0 h 8 v 8 h -8 z"/>'
  + '<path id="path3" d="M 0,0 h 400 v 3 h -400 z"/>'
  + '</svg>';

test('recoverVisionDims: pct positions convert via page size, clusters become <text>', async () => {
  const llm = fakeLLM(JSON.stringify({ dims: [{ value: '3200', x_pct: 0.5, y_pct: 0.25 }] }));
  const r = await recoverVisionDims({
    rows: vRows, svg: vSvg, pageW: 800, pageH: 1200, image: { base64: 'x', mimeType: 'image/png' }, call: llm,
  });
  assert.equal(llm.calls.length, 1);
  assert.ok(llm.calls[0].image, 'the call carried the page image');
  assert.match(llm.calls[0].text, /x_pct/);
  assert.equal(r.dims.length, 1);
  assert.equal(r.dims[0].value, '3200');
  assert.ok(Math.abs(r.dims[0].x - 400) < 1 && Math.abs(r.dims[0].y - 300) < 1, 'converted to SVG user units');
  assert.ok(textRuns(r.svg).some((x) => x.text === '3200'), 'text synthesized into the art');
});

test('recoverVisionDims: junk proposals are dropped (bad value / pct / no cluster)', async () => {
  const llm = fakeLLM(JSON.stringify({ dims: [
    { value: 'abc', x_pct: 0.5, y_pct: 0.25 },
    { value: '3200', x_pct: 1.7, y_pct: 0.25 },
    { value: '6400', x_pct: 0.9, y_pct: 0.9 },   // valid shape, but no outline cluster there
    { value: '3200', x_pct: 0.5, y_pct: 0.25 },  // duplicate value AND position: synthesized once
  ] }));
  const r = await recoverVisionDims({
    rows: vRows, svg: vSvg, pageW: 800, pageH: 1200, image: { base64: 'x', mimeType: 'image/png' }, call: llm,
  });
  assert.equal(r.dims.length, 1, 'only the one locatable, well-formed dim survives');
});

test('recoverVisionDims: same value at distinct positions is NOT a duplicate — symmetric dims all recover', async () => {
  // Two outlined "600" numbers on opposite ends of the page (a common
  // symmetric-dimension case): value alone must not dedupe them.
  const rows = [
    { id: 'path1', x: 196, y: 296, w: 8, h: 8 },   // cluster near (25%, 25%) of 800x1200
    { id: 'path2', x: 205, y: 296, w: 8, h: 8 },
    { id: 'path3', x: 596, y: 716, w: 8, h: 8 },   // cluster near (75%, 60%)
    { id: 'path4', x: 605, y: 716, w: 8, h: 8 },
  ];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">'
    + '<path id="path1" d="M 0,0 h 8 v 8 h -8 z"/>'
    + '<path id="path2" d="M 0,0 h 8 v 8 h -8 z"/>'
    + '<path id="path3" d="M 0,0 h 8 v 8 h -8 z"/>'
    + '<path id="path4" d="M 0,0 h 8 v 8 h -8 z"/>'
    + '</svg>';
  const llm = fakeLLM(JSON.stringify({ dims: [
    { value: '600', x_pct: 0.25, y_pct: 0.25 },
    { value: '600', x_pct: 0.75, y_pct: 0.6 },
  ] }));
  const r = await recoverVisionDims({
    rows, svg, pageW: 800, pageH: 1200, image: { base64: 'x', mimeType: 'image/png' }, call: llm,
  });
  assert.equal(r.dims.length, 2, 'both same-value dims land — distinct positions are distinct dims');
  assert.equal(textRuns(r.svg).filter((x) => x.text === '600').length, 2, 'both clusters synthesized');
});

test('recoverVisionDims: unknown page size (0) skips the pass cleanly — no call, no garbage clusters', async () => {
  const llm = fakeLLM(JSON.stringify({ dims: [{ value: '3200', x_pct: 0.5, y_pct: 0.25 }] }));
  const r = await recoverVisionDims({
    rows: vRows, svg: vSvg, pageW: 0, pageH: 1200, image: { base64: 'x', mimeType: 'image/png' }, call: llm,
  });
  assert.equal(r, null, 'no synthesis when positions cannot be converted to user units');
  assert.equal(llm.calls.length, 0, 'the LLM is never called');
});

test('recoverVisionDims: never throws; a no-LLM run is a quiet no-op', async () => {
  const opts = { rows: vRows, svg: vSvg, pageW: 800, pageH: 1200, image: { base64: 'x', mimeType: 'image/png' } };
  assert.equal(await recoverVisionDims({ ...opts, call: fakeLLM('not json') }), null);
  assert.equal(await recoverVisionDims({ ...opts, call: async () => { throw new Error('network'); } }), null);
  // no injected call and no key in the environment -> disabled, no vision call
  const saved = {};
  for (const k of ['LADDER_LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY']) {
    saved[k] = process.env[k]; delete process.env[k];
  }
  try {
    assert.equal(await recoverVisionDims(opts), null, 'LLM disabled -> today\'s behavior (no vision pass)');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

// ---------- scaffold report: vision rejections are never silent (issue #4) ----------

// reportScaffold is what BOTH the direct `node src/eval/scaffold.mjs` entry and
// the documented `node bin/ladder.mjs scaffold` command print through — the
// vision line must appear in both, or a hallucination rejection would be
// silent through the documented command.
test('reportScaffold: vision line reports recovered AND rejected dims (plausibility wording)', () => {
  const lines = [];
  reportScaffold({
    id: 'vision-cat', dir: '/tmp/x', outlines: 2,
    props: [{ id: 'dim1', mode: 'group', value: '3200' }],
    llmFormulas: 0, geomLines: 1, preserved: 0,
    vision: { called: true, dims: 1, rejected: 2 },
    editor: 'preview/vision-cat-editor.html', editorMB: '1.2',
  }, (s) => lines.push(s));
  const visionLine = lines.find((l) => l.startsWith('  vision'));
  assert.ok(visionLine, 'a vision line is printed');
  assert.match(visionLine, /1 dim\(s\) recovered, 2 rejected by the plausibility check/);
});

test('reportScaffold: no vision line when the pass did not run', () => {
  const lines = [];
  reportScaffold({
    id: 'trolley-slt', dir: '/tmp/y', outlines: 0,
    props: [{ id: 'dim1', mode: 'group', value: '6650' }],
    llmFormulas: 0, geomLines: 3, preserved: 0,
    vision: { called: false, dims: 0, rejected: 0 },
    editor: 'preview/trolley-slt-editor.html', editorMB: '1.1',
  }, (s) => lines.push(s));
  assert.ok(!lines.some((l) => l.startsWith('  vision')), 'silent when vision never ran');
});

// ---------- scaffold integration (the acceptance seam) ----------

const tools = availableConverters();
const CAT = join(repo, 'LSB-2609-007-FHL-R00.pdf');
// Outlined-number centres measured from the 009 corpus conversion (Inkscape
// 1.4, page 793.76 x 1122.56 user units) — the fake sees these as page pcts.
const pct = (x, y) => ({ x_pct: x / 793.76, y_pct: y / 1122.56 });
const CAT_DIMS = [
  { value: '3200', ...pct(294.2, 433.4) },
  { value: '295', ...pct(240.9, 670.9) },
  { value: '150', ...pct(257.4, 744.5) },
];

// The same fake serves both LLM passes: an image in the request means the
// vision prompt; otherwise it is the formulas prompt.
const dualFake = (visionDims, calls = []) => {
  const fn = async (req) => {
    calls.push(req);
    if (req.image) return { text: JSON.stringify({ dims: visionDims }) };
    return { text: '{"formulas":{}}' };
  };
  fn.calls = calls;
  return fn;
};

test('scaffold: zero-dims outline PDF + fake vision -> synthesized <text> dims, unverified marker, geometry bindings', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  const llm = dualFake(CAT_DIMS);
  const r = await scaffold(CAT, { llm, id: 'vision-cat', templatesDir: tmp });

  assert.ok(llm.calls.some((c) => c.image), 'the vision call carried the page image');
  assert.ok(r.vision.called, 'vision pass ran (zero text-layer dims triggered it)');
  assert.ok(r.vision.dims >= 1, `expected a kept vision dim, got ${JSON.stringify(r.vision)}`);
  assert.ok(r.props.some((p) => /^dim\d+$/.test(p.id) && p.unverified === true), 'unverified dim params proposed');

  // The base art now carries a real <text> node at the outlined position.
  const clean = readFileSync(join(tmp, 'vision-cat', 'base.clean.svg'), 'utf8');
  const run = textRuns(clean).find((x) => x.text === '3200');
  assert.ok(run, 'synthesized 3200 <text> node in the base art');
  assert.ok(Math.abs(run.x - 294.2) < 1 && Math.abs(run.y - 433.4) < 1, 'at the outlined position');

  // The unverified marker flows into the emitted template's params.
  const tpl = JSON.parse(readFileSync(join(tmp, 'vision-cat', 'template.json'), 'utf8'));
  const tDims = tpl.params.filter((p) => /^dim\d+$/.test(p.id));
  assert.ok(tDims.length >= 1 && tDims.every((p) => p.unverified === true), 'params carry unverified: true');

  // Geometry bindings came through the existing proposal path.
  assert.ok(r.geomLines >= 1, `expected a geometry binding, got ${r.geomLines}`);
  const stretches = tpl.bindings.filter((b) => b.geom?.op?.startsWith('stretch'));
  assert.ok(stretches.length >= 1, 'a dimension line tracks its value');
  assert.ok(stretches.every((b) => tDims.some((p) => p.id === b.param)), 'bound to vision dim params, no special-casing downstream');
});

test('scaffold: a hallucinated value is dropped by the px/mm gate AND reported', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  // 999999 at the 3200 outline: the dimension line there spans ~306 user units,
  // so px/mm = 306/999999 < 0.005 -> implausible -> reject.
  const llm = dualFake([{ value: '999999', ...pct(294.2, 433.4) }]);
  const r = await scaffold(CAT, { llm, id: 'vision-hallu', templatesDir: tmp });
  assert.ok(r.vision.called);
  assert.equal(r.vision.dims, 0, 'hallucinated dim dropped');
  assert.ok(r.vision.rejected >= 1, 'rejection reported in the scaffold output');
  assert.ok(!r.props.some((p) => p.unverified && p.value === '999999'), 'no unverified param carries it');
  const tpl = JSON.parse(readFileSync(join(tmp, 'vision-hallu', 'template.json'), 'utf8'));
  assert.ok(!tpl.params.some((p) => p.value === '999999'), 'not in the emitted template');
  assert.ok(!tpl.bindings.some((b) => b.geom), 'no geometry binding for it');
});

test('scaffold: no vision call when the text layer already yielded dims', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  const llm = dualFake(CAT_DIMS);
  const r = await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm, id: 'vision-trolley', templatesDir: tmp });
  assert.ok(r.props.some((p) => /^dim\d+$/.test(p.id)), 'text-layer dims exist');
  assert.equal(llm.calls.filter((c) => c.image).length, 0, 'vision prompt never sent');
  assert.equal(r.vision.called, false);
});

// ---------- vision.json result cache (issue #5) ----------

test('scaffold: second scaffold of the same source reuses vision.json, no new vision call', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  const llm = dualFake(CAT_DIMS);
  await scaffold(CAT, { llm, id: 'vision-cache', templatesDir: tmp });
  assert.equal(llm.calls.filter((c) => c.image).length, 1, 'first scaffold makes the vision call');
  assert.ok(existsSync(join(tmp, 'vision-cache', 'vision.json')), 'cache written beside the template');

  const r2 = await scaffold(CAT, { llm, id: 'vision-cache', templatesDir: tmp });
  assert.equal(llm.calls.filter((c) => c.image).length, 1, 'cached result reused, vision LLM not called again');
  assert.ok(r2.vision.called && r2.vision.dims >= 1, 'dims still recovered from the cached result');
});

test('scaffold: a modified source PDF (different content hash) re-runs vision', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  // Trailing '%' comment bytes: a different content hash, still a valid PDF.
  const mod = join(tmp, 'LSB-2609-007-FHL-R00-modified.pdf');
  writeFileSync(mod, Buffer.concat([readFileSync(CAT), Buffer.from('\n% cache-test modification\n')]));
  const llm = dualFake(CAT_DIMS);
  await scaffold(CAT, { llm, id: 'vision-cache', templatesDir: tmp });
  await scaffold(mod, { llm, id: 'vision-cache', templatesDir: tmp });
  assert.equal(llm.calls.filter((c) => c.image).length, 2, 'changed source hash -> fresh vision call');
});

test('scaffold: a corrupt vision.json degrades to a fresh vision call, not a failure', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  mkdirSync(join(tmp, 'vision-cache'), { recursive: true });
  writeFileSync(join(tmp, 'vision-cache', 'vision.json'), '{ not json');
  const llm = dualFake(CAT_DIMS);
  const r = await scaffold(CAT, { llm, id: 'vision-cache', templatesDir: tmp });
  assert.equal(llm.calls.filter((c) => c.image).length, 1, 'corrupt cache -> fresh vision call');
  assert.ok(r.vision.dims >= 1, 'scaffold still recovers dims');
  const c = JSON.parse(readFileSync(join(tmp, 'vision-cache', 'vision.json'), 'utf8'));
  assert.ok(c.hash && typeof c.reply === 'string', 'cache rewritten with the fresh result');
});

test('scaffold: text-layer scaffolds create no vision.json cache', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  const llm = dualFake(CAT_DIMS);
  await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm, id: 'vision-nocache', templatesDir: tmp });
  assert.ok(!existsSync(join(tmp, 'vision-nocache', 'vision.json')), 'no cache on the text-layer path');
});

test('scaffold: LLM disabled -> title block only, no vision synthesis (today\'s behavior)', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-vision-'));
  const r = await scaffold(CAT, { llm: false, id: 'vision-off', templatesDir: tmp });
  assert.equal(r.vision.called, false);
  assert.ok(!r.props.some((p) => /^dim\d+$/.test(p.id)), 'no dim params without the vision pass');
  const clean = readFileSync(join(tmp, 'vision-off', 'base.clean.svg'), 'utf8');
  assert.ok(!textRuns(clean).some((x) => x.text === '3200'), 'no synthesized text in the base art');
});
