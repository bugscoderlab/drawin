// convertPdf tests. Need Inkscape and/or pdftocairo on PATH — without them the
// real-conversion tests skip (they run on the Mac/VPS/CI where the tools exist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertPdf, availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TROLLEY = join(repo, 'LSB-2607-003-RHC-R00.pdf');
const PDF_009 = join(repo, 'LSB-2609-007-FHL-R00.pdf');

test('availableConverters reports what is installed', () => {
  const ok = availableConverters();
  assert.ok(Array.isArray(ok));
  for (const c of ok) assert.ok(['inkscape', 'pdftocairo'].includes(c));
});

const tools = availableConverters();
test('auto: converts the trolley PDF (Inkscape path keeps text)', { skip: tools.length === 0 && 'no converters installed' }, () => {
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  const r = convertPdf(TROLLEY, out);
  assert.ok(existsSync(out));
  assert.match(r.converter, /^(inkscape|pdftocairo)$/); // Inkscape preferred, fallback OK
  const svg = readFileSync(out, 'utf8');
  if (r.converter === 'inkscape') assert.match(svg, /<text[\s>]/, 'Inkscape output keeps a text layer');
});

test('explicit converter + missing file: throws with the backend reason', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  assert.throws(
    () => convertPdf(join(repo, 'nope.pdf'), out, { converter: tools[0] || 'pdftocairo' }),
    tools.length ? /conversion failed|ENOENT|no such/i : /not found on PATH|conversion failed/,
  );
});

test('009 segfault fallback: auto still produces an SVG', { skip: tools.length === 0 && 'no converters installed' }, () => {
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  const r = convertPdf(PDF_009, out); // Inkscape segfaults here on some builds
  assert.ok(existsSync(out));
  assert.ok(r.converter === 'inkscape' || r.converter === 'pdftocairo');
});
