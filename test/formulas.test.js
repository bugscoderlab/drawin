// 1C.8b: geometry-aware formula proposal. The LLM sees each dim's measure
// axis, text position, and glyph span — not just id/label/value — so it can
// propose structural rules (parallel extension, segment sums, offsets) that
// values alone hide. Additive literals become named constant params.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { proposeFormulas } from '../src/eval/formulas.mjs';
import { scaffold } from '../src/eval/scaffold.mjs';
import { renderById } from '../src/templates/renderCmd.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const DIMS = [
  { id: 'dim1', label: 'Dimension 1', value: '1000' },
  { id: 'dim2', label: 'Dimension 2', value: '500' },
  { id: 'dim3', label: 'Dimension 3', value: '1364' },
];

const fakeLLM = (reply) => {
  const calls = [];
  const fn = async ({ text }) => { calls.push(text); return { text: typeof reply === 'function' ? reply(text) : reply }; };
  fn.calls = calls;
  return fn;
};

test('prompt carries geometry: axis, text position, glyph span', async () => {
  const llm = fakeLLM('{"formulas":{}}');
  await proposeFormulas([
    ...DIMS,
    { id: 'dim4', label: 'Dimension 4', value: '2372', geom: { axis: 'x', pos: [271.3, 513], spanPx: 30.1 } },
  ], { call: llm });
  const prompt = llm.calls[0];
  assert.match(prompt, /dim4: axis=x textPos=\(271\.3,513\) glyphSpan=30\.1px/);
});

test('structural rule with offset: additive literal becomes a named constant', async () => {
  const llm = fakeLLM('{"formulas":{"dim3":"dim1 + dim2 - 136"}}');
  const r = await proposeFormulas(DIMS, { call: llm });
  assert.equal(r.formulas.dim3, '(dim1 + dim2 - dim3_c1).toFixed(0)');
  assert.deepEqual(r.constants, { dim3_c1: 136 });
});

test('ratio rule stays inline (no constant param for a multiplicative factor)', async () => {
  const llm = fakeLLM('{"formulas":{"dim2":"dim1 * 0.5"}}');
  const r = await proposeFormulas(DIMS, { call: llm });
  assert.equal(r.formulas.dim2, '(dim1 * 0.5).toFixed(0)');
  assert.deepEqual(r.constants, {});
});

test('proposals that fail validation are rejected', async () => {
  const bad = await proposeFormulas(DIMS, { call: fakeLLM('{"formulas":{"dim3":"dim1 + dim2 - 100"}}') }); // wrong value
  assert.deepEqual(bad.formulas, {});
  const unknown = await proposeFormulas(DIMS, { call: fakeLLM('{"formulas":{"dim3":"dim9 * 2"}}') });      // unknown ref
  assert.deepEqual(unknown.formulas, {});
  const self = await proposeFormulas(DIMS, { call: fakeLLM('{"formulas":{"dim3":"dim3 * 2"}}') });         // self ref
  assert.deepEqual(self.formulas, {});
  const syntax = await proposeFormulas(DIMS, { call: fakeLLM('{"formulas":{"dim3":"dim1; alert(1)"}}') }); // whitelist
  assert.deepEqual(syntax.formulas, {});
});

test('never throws: bad reply, throwing call, <2 numeric dims', async () => {
  assert.deepEqual(await proposeFormulas(DIMS, { call: fakeLLM('not json') }), { formulas: {}, constants: {} });
  assert.deepEqual(await proposeFormulas(DIMS, { call: async () => { throw new Error('network'); } }), { formulas: {}, constants: {} });
  assert.deepEqual(await proposeFormulas([DIMS[0]], { call: fakeLLM('{"formulas":{}}') }), { formulas: {}, constants: {} });
});

// ---- e2e: scaffold feeds geometry and ships constants as params ----

const tools = availableConverters();
test('1C.8b e2e: scaffold + fake LLM -> structural formula + constant param -> render', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-frm-'));
  // The fake LLM derives a rule from the dims it actually receives:
  // last dim = previous dim * 0.3 + offset (offset chosen to reproduce the value).
  let sawGeometry = false;
  const llm = async ({ text }) => {
    sawGeometry = /axis=[xy] textPos=\(/u.test(text);
    const list = JSON.parse(text.match(/Dimension parameters \(id, label, value in mm\):\n(\[.*?\])\n/s)[1]);
    const nums = list.filter((p) => /^[0-9.]+$/.test(p.value));
    const a = nums[nums.length - 2], b = nums[nums.length - 1];
    const av = parseFloat(a.value), bv = parseFloat(b.value);
    const offset = Math.round((bv - av * 0.3) * 10) / 10;
    return { text: JSON.stringify({ formulas: { [b.id]: `${a.id} * 0.3 + ${offset}` } }) };
  };
  const r = await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm, id: 'frm-trolley', templatesDir: tmp });
  assert.ok(r.llmFormulas >= 1, `expected a proposed formula, got ${r.llmFormulas}`);
  assert.ok(sawGeometry, 'the prompt carried dim geometry (axis/pos/span)');

  const tpl = JSON.parse(readFileSync(join(tmp, 'frm-trolley', 'template.json'), 'utf8'));
  const formulaParam = tpl.params.find((p) => p.formula);
  assert.ok(formulaParam, 'a param carries the proposed formula');
  const constParam = tpl.params.find((p) => p.const);
  assert.ok(constParam, 'the offset became a named constant param');
  assert.ok(formulaParam.formula.includes(constParam.id), 'formula references the constant');
  assert.ok(!tpl.bindings.some((b) => b.param === constParam.id), 'constants have no art binding');
  assert.ok(!Object.keys(tpl.sample).includes(constParam.id), 'constants are not in the sample');

  // Render the sample: the derived dim shows the formula result, not the raw default.
  const out = renderById(tmp, 'frm-trolley', tpl.sample);
  assert.ifError(out.error);
  const { resolveParams } = await import('../src/templates/render.mjs');
  const derived = resolveParams(tpl.params, tpl.sample)[formulaParam.id];
  assert.ok(out.svg.includes(`>${derived}<`), `derived value ${derived} rendered`);
});
