// Registry tests: load templates/, score signals, pick winners, stay deterministic.
// The contract under test: match or null — never an error, never a guess below
// threshold, real art (L1) beats code models (L3) on ties.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry, matchTemplate, scoreTemplate, L3_TEMPLATES } from '../src/templates/registry.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(repo, 'templates');

test('loadRegistry: loads the 4 authored templates + 3 L3 seeds, no errors', () => {
  const { templates, errors } = loadRegistry(TEMPLATES);
  assert.deepEqual(errors, []);
  const ids = templates.map((t) => t.id).sort();
  assert.deepEqual(ids, ['cage-fhl', 'cage-l3', 'cat-l3', 'lsb-2607-003-rhc-r00', 'lsb-2607-004-fhl-r00', 'trolley-l3', 'trolley-slt']);
  for (const t of templates.filter((t) => t.kind === 'l1')) assert.ok(t.dir, `${t.id} must carry its dir`);
});

test('loadRegistry: a broken template is skipped, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  writeFileSync(join(dir, 'template.json'), '{"id": "not-a-dir-layout"}'); // file, not a folder
  mkdirSync(join(dir, 'good')); mkdirSync(join(dir, 'bad'));
  writeFileSync(join(dir, 'good', 'base.svg'), '<svg/>');
  writeFileSync(join(dir, 'good', 'template.json'), JSON.stringify({
    id: 'good', name: 'Good', base: { svg: 'base.svg' }, params: [], bindings: [], match: {},
  }));
  writeFileSync(join(dir, 'bad', 'template.json'), '{invalid json');
  const { templates, errors } = loadRegistry(dir, { withL3: false });
  assert.deepEqual(templates.map((t) => t.id), ['good']);
  assert.equal(errors.length, 1); // only the broken JSON; the stray root file is skipped silently
});

const TROLLEY_SIGNALS = { title: 'ALUMINIUM SAFETY LADDER TROLLEY 9 STEP', drawingNo: 'LSB-2607-003-RHC-R00' };
const CAGE_SIGNALS = { title: 'CAT LADDER WITH SAFETY CAGE', drawingNo: 'LSB/2607/004/FHL/R00' };
const CAT_SIGNALS = { title: 'ALUMINIUM CAT LADDER BODY TYPE', drawingNo: 'LSB/2609/007/FHL/R00' };

test('matchTemplate: corpus signals pick the right family, L1 art beats L3 on ties', () => {
  const { templates } = loadRegistry(TEMPLATES);
  const trolley = matchTemplate(templates, TROLLEY_SIGNALS);
  assert.equal(trolley.template.id, 'trolley-slt');
  assert.equal(trolley.score, 5); // 1 keyword + pattern
  assert.equal(matchTemplate(templates, CAGE_SIGNALS).template.id, 'cage-fhl');
  assert.equal(matchTemplate(templates, CAT_SIGNALS).template.id, 'cat-l3'); // no authored cat template yet
});

test('matchTemplate: drawing-no pattern alone must NOT match (no keyword)', () => {
  const { templates } = loadRegistry(TEMPLATES);
  const generic = { title: 'GENERAL ARRANGEMENT LADDER', drawingNo: 'LSB/9999/999/XXX/R00' };
  assert.equal(matchTemplate(templates, generic), null);
});

test('matchTemplate: unrelated or empty signals -> null, never an error', () => {
  const { templates } = loadRegistry(TEMPLATES);
  assert.equal(matchTemplate(templates, {}), null);
  assert.equal(matchTemplate(templates, { title: 'WATER TANK SCHEDULE', drawingNo: 'WT-001' }), null);
});

test('scoreTemplate: dimension signature adds supporting points', () => {
  const tpl = { match: { titleKeywords: ['TANK'], drawingNoPattern: '^WT-', dimensions: ['3500', 700] } };
  const s = scoreTemplate(tpl, { title: 'TANK', drawingNo: 'WT-1', dimensions: ['3,500 MM', 700.0, 999] });
  assert.equal(s.score, 7); // 3 (keyword) + 2 (pattern) + 2 (both declared dims found)
  assert.deepEqual(s.hits.dimensions, ['3500', 700]);
  assert.equal(scoreTemplate(tpl, { title: 'TANK', drawingNo: 'XX-1' }).score, 3); // below threshold alone
});

test('L3 seeds point at real core modules', () => {
  for (const t of L3_TEMPLATES) assert.ok(['cat', 'cage', 'trolley'].includes(t.module));
});
