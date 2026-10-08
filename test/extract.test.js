// Extraction pipeline tests. Pure unit tests always run; corpus tests need
// poppler (they ran against the real PDFs during development).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stitchText, bridgeCompany } from '../src/extract/stitch.mjs';
import { parseNumber, parseLoad, parseAngle, parseDate, parseHeightPair } from '../src/extract/normalize.mjs';
import { applyProfile, PROFILES } from '../src/extract/profiles.mjs';
import { extractRules } from '../src/extract/rules.mjs';
import { hasPoppler } from '../src/extract/text.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- pure units (no poppler) -------------------------------------------------
test('stitch: three views of fragmented text', () => {
  const s = stitchText('Heigh t : 6 650mm + 900mm\nFHL  CONSTRUCTION   SDN BHD\r\n');
  assert.equal(s.sq, 'Height:6650mm+900mmFHLCONSTRUCTIONSDNBHD');
  assert.match(s.flat, /Heigh t : 6 650mm \+ 900mm/);
  assert.deepEqual(s.lines, ['Heigh t : 6 650mm + 900mm', 'FHL  CONSTRUCTION   SDN BHD']);
});

test('stitch: nbsp normalized', () => {
  assert.equal(stitchText('a b').flat, 'a b');
});

test('bridgeCompany: joins the "… Tel SDN BHD" split', () => {
  const flat = 'Customer FHL CONSTRUCTION Tel SDN BHD Tel 03-1234';
  assert.deepEqual(bridgeCompany(flat), ['FHL CONSTRUCTION SDN BHD']);
});

test('normalize: numbers, load, angle, date, height pair', () => {
  assert.equal(parseNumber('3,500 MM'), 3500);
  assert.equal(parseNumber('7.5'), 7.5);
  assert.equal(parseNumber('n/a'), null);
  assert.equal(parseLoad('150 KG'), '150KG');
  assert.equal(parseLoad('1500 KG'), null); // >3 digits not a working load
  assert.equal(parseAngle('(60°)'), '60');
  assert.equal(parseDate('07-09-2026'), '07-09-2026');
  assert.equal(parseDate('2026-09-07'), null);
  assert.deepEqual(parseHeightPair('Height:6,650mm+900mm'), { a: 6650, b: 900 });
});

test('profiles: nar beats laddertech when both signals present', () => {
  const fields = { drawingNo: 'NAR-LA-LT-CL-060', revision: null };
  const { profile, fixes } = applyProfile(fields, stitchText('NAR shop drawing LADDERTECH LSB-2607-003-RHC-R00'));
  assert.equal(profile, 'nar');
  assert.equal(fields.drawingNo, 'LSB-2607-003-RHC-R00');
  assert.equal(fields.revision, 'R00');
  assert.ok(fixes.length >= 2);
});

test('profiles: laddertech sheet detected, generic fallback', () => {
  assert.equal(applyProfile({}, stitchText('Laddertech Sdn Bhd Title: X')).profile, 'laddertech');
  assert.equal(applyProfile({}, stitchText('ACME WIDGETS DRAWING')).profile, 'generic');
});

// --- corpus (poppler) ---------------------------------------------------------
const poppler = hasPoppler();
test('corpus: trolley extraction (rules)', { skip: !poppler && 'poppler not installed' }, async () => {
  const { extractParams } = await import('../src/extract/extract.mjs');
  const r = await extractParams(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm: 'off' });
  assert.equal(r.module, 'trolley');
  assert.equal(r.profile, 'nar');
  assert.equal(r.params.drawingNo, 'LSB-2607-003-RHC-R00');
  assert.equal(r.params.revision, '00');
  assert.equal(r.params.customer, 'RAHABCO ENGINEERING & CONSTRUCTION SDN BHD');
  assert.equal(r.params.steps, 9);
  assert.equal(r.params.angle, '60');
  assert.equal(r.params.overallHeight, 3500);
  assert.equal(r.params.workingLoad, '150KG');
  assert.equal(r.params.productName, 'ALUMINIUM SAFETY LADDER TROLLEY 9 STEP (CUSTOMIZED)');
});

test('corpus: cage extraction (rules) + core mapping', { skip: !poppler && 'poppler not installed' }, async () => {
  const { extractParams } = await import('../src/extract/extract.mjs');
  const r = await extractParams(join(repo, 'LSB-2607-004-FHL-R00.pdf'), { llm: 'off' });
  assert.equal(r.module, 'cage');
  assert.equal(r.profile, 'nar');
  assert.equal(r.params.drawingNo, 'LSB/2607/004/FHL/R00');
  assert.equal(r.params.customer, 'FHL CONSTRUCTION SDN BHD');
  assert.equal(r.params.material, 'Aluminium');
  assert.equal(r.params.finishing, 'MF');
  assert.equal(r.params.floorToLanding, 6650);
  assert.equal(r.params.handrailHeight, 900);
  assert.deepEqual(r.core, { cageLadderHeight: 6650, cageHandrailHeight: 900 });
});

test('corpus: cat extraction (rules) — overallHeight is a known text-layer gap', { skip: !poppler && 'poppler not installed' }, async () => {
  const { extractParams } = await import('../src/extract/extract.mjs');
  const r = await extractParams(join(repo, 'LSB-2609-007-FHL-R00.pdf'), { llm: 'off' });
  assert.equal(r.module, 'cat');
  assert.equal(r.profile, 'laddertech');
  assert.equal(r.params.drawingNo, 'LSB/2609/007/FHL/R00');
  assert.equal(r.params.customer, 'FHL CONSTRUCTION SDN BHD');
  assert.equal(r.params.date, '07-09-2026');
  assert.equal(r.params.overallHeight, null, 'callout never reaches the text layer — vision fills it');
  assert.ok(r.warnings.some((w) => w.startsWith('missing field: overallHeight')));
});

test('rules: company disambiguation skips the manufacturer', () => {
  const text = 'LADDERTECH SDN BHD\nCustomer\nACME ENGINEERING SDN BHD\n';
  const r = extractRules(text, null);
  assert.equal(r.customer, 'ACME ENGINEERING SDN BHD');
});
