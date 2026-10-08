// Issue #3: preserve-by-default re-scaffold. Re-running scaffold over an
// existing template dir keeps what a human may have tuned (per-param formulas,
// labels, named constant params, hand-made id-bindings whose ids still exist
// in the base art) and recomputes what is deterministic (outline duplicate
// hiding, dimension bindings, geometry bindings). An explicit --force (opts.force)
// restores the from-scratch wipe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffold } from '../src/eval/scaffold.mjs';
import { textRuns } from '../src/templates/render.mjs';
import { renderById } from '../src/templates/renderCmd.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = availableConverters();
const PDF = join(repo, 'LSB-2607-003-RHC-R00.pdf');

const readTpl = (tmp, id) => JSON.parse(readFileSync(join(tmp, id, 'template.json'), 'utf8'));
const writeTpl = (tmp, id, tpl) => writeFileSync(join(tmp, id, 'template.json'), JSON.stringify(tpl, null, 2) + '\n');

// Derives a rule from the dims it actually receives (like formulas.test.js):
// last dim = previous dim * 0.3 + offset (offset chosen to reproduce the value),
// so the additive literal becomes a named constant param.
const fakeLLM = async ({ text }) => {
  const list = JSON.parse(text.match(/Dimension parameters \(id, label, value in mm\):\n(\[.*?\])\n/s)[1]);
  const nums = list.filter((p) => /^[0-9.]+$/.test(p.value));
  const a = nums[nums.length - 2], b = nums[nums.length - 1];
  const offset = Math.round((parseFloat(b.value) - parseFloat(a.value) * 0.3) * 10) / 10;
  return { text: JSON.stringify({ formulas: { [b.id]: `${a.id} * 0.3 + ${offset}` } }) };
};

test('re-scaffold preserves prior param formula, label, and named constant', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  const r1 = await scaffold(PDF, { llm: fakeLLM, id: 're-trolley', templatesDir: tmp });
  assert.ok(r1.llmFormulas >= 1, 'first pass proposed a formula');
  const tpl1 = readTpl(tmp, 're-trolley');
  const f1 = tpl1.params.find((p) => p.formula);
  assert.ok(f1, 'a param carries the proposed formula');
  assert.ok(tpl1.params.some((p) => p.const), 'the offset became a named constant param');

  // human tuning between runs, as the editor would write it
  tpl1.params.find((p) => p.id === 'dim1').label = 'Platform length';
  writeTpl(tmp, 're-trolley', tpl1);

  // re-scaffold WITHOUT the LLM: carry-over must keep the human work alive
  const r2 = await scaffold(PDF, { llm: false, id: 're-trolley', templatesDir: tmp });
  const tpl2 = readTpl(tmp, 're-trolley');
  const f2 = tpl2.params.find((p) => p.id === f1.id);
  assert.equal(f2?.formula, f1.formula, 'prior formula survives re-scaffold');
  assert.ok(tpl2.params.some((p) => p.const), 'named constant param survives (referenced by the carried formula)');
  assert.equal(tpl2.params.find((p) => p.id === 'dim1').label, 'Platform length', 'hand-set label survives');
});

test('hand-made id-binding survives when its ids exist in the base art, drops when gone', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: false, id: 're-bind', templatesDir: tmp });

  // hand-made edits, as POST /bind writes them: re-anchor by element id
  const tpl = readTpl(tmp, 're-bind');
  const clean = readFileSync(join(tmp, 're-bind', 'base.clean.svg'), 'utf8');
  const wlId = textRuns(clean).find((r) => r.text === '150KG').id;
  tpl.bindings = tpl.bindings.filter((b) => b.param !== 'workingLoad' && b.param !== 'customer');
  tpl.bindings.push({ ids: [wlId], param: 'workingLoad', mode: 'id' });
  tpl.bindings.push({ ids: ['ghost-element'], param: 'customer', mode: 'id' }); // ids no longer in the art
  writeTpl(tmp, 're-bind', tpl);

  const r2 = await scaffold(PDF, { llm: false, id: 're-bind', templatesDir: tmp });
  assert.equal(r2.preserved, 1, 'exactly the live id-binding is carried over');
  const tpl2 = readTpl(tmp, 're-bind');
  assert.deepEqual(
    tpl2.bindings.find((b) => b.param === 'workingLoad'),
    { ids: [wlId], param: 'workingLoad', mode: 'id' },
    'hand-made id-binding survives re-scaffold'
  );
  assert.ok(!tpl2.bindings.some((b) => (b.ids || []).includes('ghost-element')), 'binding whose ids are gone is dropped');
  assert.ok(tpl2.bindings.some((b) => b.param === 'customer' && b.value), 'value bindings are still rebuilt fresh');

  // the preserved binding still drives the render
  const out = renderById(tmp, 're-bind', tpl2.sample);
  assert.ifError(out.error);
  assert.ok(out.report.find((b) => b.param === 'workingLoad' && b.ids)?.ok, 'id-binding applies at render');
  assert.ok(out.svg.includes('>200KG<'), 'sample value lands on the id-bound element');
});

test('geometry bindings are re-proposed from the current art, not copied over', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: false, id: 're-geom', templatesDir: tmp });

  // tamper with the geometry + inject a hand-made geom binding — none may survive
  const tpl = readTpl(tmp, 're-geom');
  const stretch = tpl.bindings.find((b) => b.geom?.op?.startsWith('stretch'));
  stretch.geom.anchor = 424242;
  tpl.bindings.push({ ids: ['path1445'], param: 'dim1', geom: { op: 'stretchX', anchor: 424242 } });
  writeTpl(tmp, 're-geom', tpl);

  const r2 = await scaffold(PDF, { llm: false, id: 're-geom', templatesDir: tmp });
  assert.ok(r2.geomLines >= 1, 'geometry re-proposed from the current art');
  const tpl2 = readTpl(tmp, 're-geom');
  assert.ok(!tpl2.bindings.some((b) => b.geom?.anchor === 424242), 'stale or hand-injected geometry is not carried over');
  assert.ok(
    tpl2.bindings.filter((b) => b.geom?.op?.startsWith('stretch')).length
      === tpl.bindings.filter((b) => b.geom?.op?.startsWith('stretch')).length - 1,
    'fresh proposals replace the tampered set one-for-one'
  );
});

test('scaffold with force: true wipes the prior template (from-scratch behavior)', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: fakeLLM, id: 're-force', templatesDir: tmp });
  await scaffold(PDF, { llm: false, id: 'fresh-cmp', templatesDir: tmp }); // from-scratch reference

  // human work between runs
  const tpl = readTpl(tmp, 're-force');
  tpl.params.find((p) => p.id === 'dim1').label = 'Platform length';
  tpl.bindings.push({ ids: ['path1445'], param: 'dim1', mode: 'id' });
  writeTpl(tmp, 're-force', tpl);

  const r2 = await scaffold(PDF, { llm: false, force: true, id: 're-force', templatesDir: tmp });
  assert.equal(r2.preserved, 0, 'nothing carried over under --force');
  const forced = readTpl(tmp, 're-force');
  const fresh = readTpl(tmp, 'fresh-cmp');
  assert.deepEqual(forced.params, fresh.params, 'params identical to a from-scratch scaffold');
  assert.deepEqual(forced.bindings, fresh.bindings, 'bindings identical to a from-scratch scaffold');
});
