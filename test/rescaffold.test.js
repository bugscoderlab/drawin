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

test('hand-made part binding survives re-scaffold with fresh calibration when ids exist and value matches', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: false, id: 're-part', templatesDir: tmp });

  // hand-made part binding for a dim the fresh proposal skips (dim5 on 003),
  // written with stale calibration — re-scaffold must keep it but re-derive
  // anchor/pxPerUnit from the fresh art (ticket #12)
  const tpl = readTpl(tmp, 're-part');
  tpl.bindings.push({ ids: ['path2'], param: 'dim5', geom: { op: 'shiftY', anchor: 424242, pxPerUnit: 0.000001 } });
  writeTpl(tmp, 're-part', tpl);

  const r2 = await scaffold(PDF, { llm: false, id: 're-part', templatesDir: tmp });
  assert.equal(r2.preservedParts, 1, 'exactly the hand-made part binding is carried over');
  const tpl2 = readTpl(tmp, 're-part');
  const kept = tpl2.bindings.find((b) => (b.ids || []).includes('path2'));
  assert.ok(kept, 'hand-made part binding survives re-scaffold');
  assert.equal(kept.param, 'dim5', 'membership: param kept');
  assert.equal(kept.geom.op, 'shiftY', 'membership: op kept');
  assert.equal(kept.geom.anchor, 1000, 'stale anchor recomputed from the fresh dim value');
  const arrow = tpl2.bindings.find((b) => b.param === 'dim5' && b.geom?.op === 'shiftY' && b.ids?.length === 1);
  assert.ok(Math.abs(kept.geom.pxPerUnit - arrow.geom.pxPerUnit) < 1e-9, 'stale pxPerUnit recomputed from the fresh art');

  // the carried binding still drives the render
  const out = renderById(tmp, 're-part', tpl2.sample);
  assert.ifError(out.error);
  assert.ok(out.report.find((b) => (b.ids || []).includes('path2'))?.ok, 'carried part binding applies at render');
});

test('hand-made part binding drops when the value changed or an id is gone', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: false, id: 're-partdrop', templatesDir: tmp });

  const tpl = readTpl(tmp, 're-partdrop');
  // dim ids are positional: a changed value means the fresh art moved, so the
  // binding must not follow the id onto a different dimension
  tpl.params.find((p) => p.id === 'dim6').default = '999';
  tpl.bindings.push({ ids: ['path3'], param: 'dim6', geom: { op: 'stretchY', about: 'max', anchor: 305 } });
  tpl.bindings.push({ ids: ['ghost-part'], param: 'dim5', geom: { op: 'shiftY', anchor: 1000, pxPerUnit: 0.1 } });
  writeTpl(tmp, 're-partdrop', tpl);

  const r2 = await scaffold(PDF, { llm: false, id: 're-partdrop', templatesDir: tmp });
  assert.equal(r2.preservedParts, 0, 'nothing carried over');
  const tpl2 = readTpl(tmp, 're-partdrop');
  assert.ok(!tpl2.bindings.some((b) => (b.ids || []).includes('path3')), 'binding whose value changed is dropped');
  assert.ok(!tpl2.bindings.some((b) => (b.ids || []).includes('ghost-part')), 'binding whose ids are gone is dropped');
});

test('auto-proposed part bindings are always recomputed, never carried', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: false, id: 're-partauto', templatesDir: tmp });

  // tamper with an auto-proposed part binding's calibration — the fresh
  // proposal must win, so stale calibration can never survive
  const tpl = readTpl(tmp, 're-partauto');
  const auto = tpl.bindings.find((b) => b.geom?.about);
  auto.geom.anchor = 424242;
  writeTpl(tmp, 're-partauto', tpl);

  const r2 = await scaffold(PDF, { llm: false, id: 're-partauto', templatesDir: tmp });
  assert.equal(r2.preservedParts, 0, 'auto-proposed part bindings are never carried');
  const tpl2 = readTpl(tmp, 're-partauto');
  assert.ok(!tpl2.bindings.some((b) => b.geom?.anchor === 424242), 'tampered calibration is not carried over');
  const fresh = tpl2.bindings.find((b) => (b.ids || []).includes(auto.ids[0]));
  assert.equal(fresh.geom.anchor, 980, 'fresh proposal recomputes the calibration');
});

test('scaffold with force: true wipes the prior template (from-scratch behavior)', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-re-'));
  await scaffold(PDF, { llm: fakeLLM, id: 're-force', templatesDir: tmp });
  await scaffold(PDF, { llm: false, id: 'fresh-cmp', templatesDir: tmp }); // from-scratch reference

  // human work between runs
  const tpl = readTpl(tmp, 're-force');
  tpl.params.find((p) => p.id === 'dim1').label = 'Platform length';
  tpl.bindings.push({ ids: ['path1445'], param: 'dim1', mode: 'id' });
  tpl.bindings.push({ ids: ['path1446'], param: 'dim5', geom: { op: 'shiftY', anchor: 1000, pxPerUnit: 0.1 } });
  writeTpl(tmp, 're-force', tpl);

  const r2 = await scaffold(PDF, { llm: false, force: true, id: 're-force', templatesDir: tmp });
  assert.equal(r2.preserved, 0, 'nothing carried over under --force');
  assert.equal(r2.preservedParts, 0, 'hand-made part bindings wiped under --force too');
  const forced = readTpl(tmp, 're-force');
  const fresh = readTpl(tmp, 'fresh-cmp');
  assert.deepEqual(forced.params, fresh.params, 'params identical to a from-scratch scaffold');
  assert.deepEqual(forced.bindings, fresh.bindings, 'bindings identical to a from-scratch scaffold');
});
