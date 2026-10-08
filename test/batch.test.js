// Batch tests (PLAN 3.1): a folder of PDFs -> per-PDF artefacts + summary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { batch } from '../src/batch.mjs';
import { hasPoppler } from '../src/extract/text.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const poppler = hasPoppler();

test('batch: corpus folder -> params + converted + generated + reports', { skip: !poppler && 'poppler not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-in-'));
  const out = mkdtempSync(join(tmpdir(), 'batch-out-'));
  for (const f of ['LSB-2607-003-RHC-R00.pdf', 'LSB-2607-004-FHL-R00.pdf', 'LSB-2609-007-FHL-R00.pdf']) {
    copyFileSync(join(repo, f), join(dir, f));
  }
  copyFileSync(join(dir, 'LSB-2607-003-RHC-R00.pdf'), join(dir, 'not a pdf.txt'));

  const r = await batch(dir, out, { llm: 'off', templatesDir: join(repo, 'templates') });
  assert.equal(r.files, 3);
  assert.equal(r.failed, 0);

  for (const slug of ['LSB-2607-003-RHC-R00', 'LSB-2607-004-FHL-R00', 'LSB-2609-007-FHL-R00']) {
    for (const ext of ['params.json', 'converted.svg', 'generated.svg', 'report.md']) {
      assert.ok(existsSync(join(out, `${slug}.${ext}`)), `${slug}.${ext} exists`);
    }
  }
  const params = JSON.parse(readFileSync(join(out, 'LSB-2607-004-FHL-R00.params.json'), 'utf8'));
  assert.equal(params.module, 'cage');
  assert.equal(params.params.floorToLanding, 6650);

  const summary = readFileSync(join(out, 'report.md'), 'utf8');
  assert.match(summary, /3\/3 ok/);
  assert.match(summary, /cage-fhl|l1:cage-fhl/);
});

test('batch: one bad PDF is reported, the rest still process', { skip: !poppler && 'poppler not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'batch-in-'));
  const out = mkdtempSync(join(tmpdir(), 'batch-out-'));
  copyFileSync(join(repo, 'LSB-2607-004-FHL-R00.pdf'), join(dir, 'good.pdf'));
  writeFileSync(join(dir, 'broken.pdf'), '%PDF-1.4 not really a pdf');

  const r = await batch(dir, out, { llm: 'off', templatesDir: join(repo, 'templates') });
  assert.equal(r.files, 2);
  assert.equal(r.ok, 1);
  assert.equal(r.failed, 1);
  assert.ok(existsSync(join(out, 'good.params.json')));
  const summary = readFileSync(join(out, 'report.md'), 'utf8');
  assert.match(summary, /failures/);
});
