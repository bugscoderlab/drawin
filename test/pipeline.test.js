// Pipeline tests (PLAN 2.1c/d): extract -> generate renders via the matched
// template (L1 art by id-overlap, L3 fallback), and verify confirms every
// extracted dimension appears in the generated drawing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateFromExtract, findNumber } from '../src/pipeline.mjs';
import { extractParams } from '../src/extract/extract.mjs';
import { hasPoppler } from '../src/extract/text.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(repo, 'templates');
const poppler = hasPoppler();

test('generate: trolley extract renders via L1 art with bound values', { skip: !poppler && 'poppler not installed' }, async () => {
  const r = await extractParams(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm: 'off' });
  const g = generateFromExtract(r, { templatesDir: TEMPLATES });
  assert.equal(g.via, 'l1:trolley-slt');
  assert.ok(g.svg.includes('RAHABCO ENGINEERING'));
  assert.ok(g.svg.includes('LSB-2607-003-RHC-R00'));
  for (const id of ['customer', 'drawingNo', 'overallHeight', 'workingLoad', 'productName']) {
    assert.ok(g.bound.includes(id), `bound: ${id}`);
  }
  assert.ok(g.unbound.includes('footprint'), 'footprint is a vision-only field — template default applies');
});

test('generate: cage extract binds the shared dims, defaults the rest', { skip: !poppler && 'poppler not installed' }, async () => {
  const r = await extractParams(join(repo, 'LSB-2607-004-FHL-R00.pdf'), { llm: 'off' });
  const g = generateFromExtract(r, { templatesDir: TEMPLATES });
  assert.equal(g.via, 'l1:cage-fhl');
  assert.ok(g.bound.includes('floorToLanding'));
  assert.ok(g.unbound.includes('cageHeight'), 'cage height is not an extract field — template default applies');
});

test('generate: cat extract falls back to the L3 model (no authored cat template)', { skip: !poppler && 'poppler not installed' }, async () => {
  const r = await extractParams(join(repo, 'LSB-2609-007-FHL-R00.pdf'), { llm: 'off' });
  const g = generateFromExtract(r, { templatesDir: TEMPLATES });
  assert.equal(g.via, 'l3:cat');
  assert.ok(g.svg.includes('CAT LADDER'));
});

test('findNumber: single run, formatted run, and per-glyph group', async () => {
  const { textRuns } = await import('../src/templates/render.mjs');
  const runs = textRuns(`
    <text x="1" y="1">6,650.00</text>
    <text x="2" y="2">2</text><text x="3" y="2">5</text><text x="4" y="2">0</text><text x="5" y="2">0</text>
    <text x="6" y="3">plain</text>`);
  assert.equal(findNumber(runs, 6650)?.where, 'run');
  assert.equal(findNumber(runs, 2500)?.where, 'group');
  assert.equal(findNumber(runs, 99999), null);
});

test('verify: corpus dimensions are present in the generated drawings', { skip: !poppler && 'poppler not installed' }, async () => {
  const { verifyPdf } = await import('../src/pipeline.mjs');
  for (const [file, dims] of [
    ['LSB-2607-004-FHL-R00.pdf', ['floorToLanding', 'handrailHeight']],
    ['LSB-2607-003-RHC-R00.pdf', ['overallHeight']],
  ]) {
    const r = await verifyPdf(join(repo, file), { llm: 'off', templatesDir: TEMPLATES });
    assert.equal(r.total, r.checks.length);
    for (const d of dims) {
      const c = r.checks.find((x) => x.field === d);
      assert.ok(c, `check exists: ${d}`);
      assert.ok(c.ok, `${d} (${c.value}) present via ${r.via}`);
    }
  }
});
