// Scoreboard tests (PLAN 1B.7/1B.8): rules-only scoring runs without a key;
// per-field rows cover all 34 corpus fields; totals match the field sets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreFiles, resolveCorpus } from '../src/eval/scoreboard.mjs';
import { FIELDS } from '../src/eval/truth.mjs';
import { hasPoppler } from '../src/extract/text.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const poppler = hasPoppler();
test('resolveCorpus finds the 3 reference PDFs from the repo root', () => {
  const files = resolveCorpus(repo);
  assert.equal(files.length, 3);
});

test('rules-only scoreboard: 34 fields, totals agree with rows', { skip: !poppler && 'poppler not installed' }, async () => {
  const { results, totals, key } = await scoreFiles(resolveCorpus(repo), { vision: false });
  assert.equal(key, null, 'no key in this environment -> rules-only');
  assert.deepEqual(Object.keys(totals).sort(), ['merged', 'rules']);
  const n = results.reduce((a, r) => a + r.rows.length, 0);
  assert.equal(n, 34, '34 corpus fields across 3 PDFs');
  assert.equal(totals.rules[1], 34);
  assert.equal(totals.merged[1], 34);
  // merged == rules when there is no vision to fill gaps
  assert.deepEqual(totals.merged, totals.rules);
  for (const r of results) {
    const want = FIELDS[r.module];
    assert.deepEqual(r.rows.map((x) => x.field), want);
    for (const row of r.rows) assert.ok(['hit', 'miss', 'wrong'].includes(row.cells.rules));
  }
});

test('rules-only scoreboard: hits match the known rules anchors', { skip: !poppler && 'poppler not installed' }, async () => {
  const { results, totals } = await scoreFiles(resolveCorpus(repo), { vision: false });
  const byFile = Object.fromEntries(results.map((r) => [r.file, r]));
  const hit = (f, field) => byFile[f].rows.find((x) => x.field === field)?.cells.rules === 'hit';

  assert.ok(hit('LSB-2607-003-RHC-R00.pdf', 'drawingNo'));
  assert.ok(hit('LSB-2607-003-RHC-R00.pdf', 'customer'));
  assert.ok(hit('LSB-2607-003-RHC-R00.pdf', 'steps'));
  assert.ok(hit('LSB-2607-003-RHC-R00.pdf', 'overallHeight'));
  assert.ok(hit('LSB-2607-004-FHL-R00.pdf', 'floorToLanding'));
  assert.ok(hit('LSB-2607-004-FHL-R00.pdf', 'handrailHeight'));
  assert.ok(hit('LSB-2609-007-FHL-R00.pdf', 'drawingNo'));
  assert.ok(hit('LSB-2609-007-FHL-R00.pdf', 'date'));
  // known text-layer gaps: rules miss them (vision fills them in merged runs)
  assert.equal(byFile['LSB-2609-007-FHL-R00.pdf'].rows.find((x) => x.field === 'overallHeight').cells.rules, 'miss');
  assert.ok(totals.rules[0] >= 20, `rules anchor count sane (got ${totals.rules[0]})`);
});
