// pdf.js text-layer tests (PLAN 2.6 / P1): items -> layout clustering, and the
// same ruleset as the CLI running over the pdf.js text of the corpus PDFs.
// Runs in Node without poppler (pdfjs-dist is a dev dependency).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pdfjsLayout, itemsToLayout } from '../src/extract/pdfjsText.mjs';
import { extractRules } from '../src/extract/rules.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

test('itemsToLayout: clusters baselines and preserves column gaps', () => {
  const layout = itemsToLayout([
    { str: 'Customer', transform: [16, 0, 0, 16, 100, 700], width: 60 },
    { str: 'ACME SDN BHD', transform: [16, 0, 0, 16, 400, 700], width: 110 },
    { str: 'Revision', transform: [16, 0, 0, 16, 100, 680], width: 55 },
    { str: '00', transform: [16, 0, 0, 16, 400, 680], width: 20 },
  ]);
  const lines = layout.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Customer {5,}ACME SDN BHD$/);
  assert.match(lines[1], /^Revision {5,}00$/);
});

test('pdf.js text layer + CLI ruleset: corpus anchors (no poppler needed)', async () => {
  const cases = [
    ['LSB-2607-003-RHC-R00.pdf', (r) => r.productType === 'trolley' && r.drawingNo === 'LSB-2607-003-RHC-R00'
      && r.customer === 'RAHABCO ENGINEERING & CONSTRUCTION SDN BHD' && r.steps === '9' && r.overallHeight === '3,500'],
    ['LSB-2607-004-FHL-R00.pdf', (r) => r.productType === 'cage' && r.drawingNo === 'LSB/2607/004/FHL/R00'
      && r.floorToLanding === '6650' && r.handrailHeight === '900'],
    ['LSB-2609-007-FHL-R00.pdf', (r) => r.productType === 'cat' && r.drawingNo === 'LSB/2609/007/FHL/R00'
      && r.date === '07-09-2026'],
  ];
  for (const [file, ok] of cases) {
    const layout = await pdfjsLayout(new Uint8Array(readFileSync(join(repo, file))));
    const rules = extractRules(layout, null);
    assert.ok(ok(rules), `${file}: ${JSON.stringify(rules)}`);
  }
});
