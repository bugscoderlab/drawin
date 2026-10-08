// convertPdf tests. Need Inkscape and/or pdftocairo on PATH — without them the
// real-conversion tests skip (they run on the Mac/VPS/CI where the tools exist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertPdf, availableConverters } from '../src/convert/convert.mjs';

const BIG_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">ok</text>' + ' '.repeat(300) + '</svg>\n';

const fakeRunner = (behaviour) => {
  const calls = [];
  const runner = {
    calls,
    inkscape(pdf, out) {
      calls.push(['inkscape', pdf]);
      if (behaviour.inkscape === 'segfault' && pdf !== behaviour.repaired) { const e = new Error('crashed'); e.signal = 'SIGSEGV'; throw e; }
      if (behaviour.inkscape === 'fail') throw new Error('import error');
      writeFileSync(out, BIG_SVG);
    },
    pdftocairo(pdf, out) {
      calls.push(['pdftocairo', pdf]);
      if (behaviour.pdftocairo === 'fail') throw new Error('cairo error');
      writeFileSync(out, BIG_SVG);
    },
    gsRepair(pdf) {
      calls.push(['gsRepair', pdf]);
      if (behaviour.gsRepair === 'fail') throw new Error('gs error');
      return behaviour.repaired || null;
    },
  };
  return runner;
};

test('auto chain: segfault -> gs repair -> inkscape succeeds (the 009 fix)', () => {
  const runner = fakeRunner({ inkscape: 'segfault', repaired: '/tmp/repaired.pdf' });
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  const r = convertPdf('in.pdf', out, { runner });
  assert.equal(r.converter, 'inkscape');
  assert.equal(r.repaired, true);
  assert.deepEqual(runner.calls.map((c) => c[0]), ['inkscape', 'gsRepair', 'inkscape']);
  assert.equal(runner.calls[2][1], '/tmp/repaired.pdf');
});

test('auto chain: all hops fail -> throws naming every attempt', () => {
  const runner = fakeRunner({ inkscape: 'fail', gsRepair: 'fail', pdftocairo: 'fail' });
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  assert.throws(() => convertPdf('in.pdf', out, { runner }), /inkscape.*gs.*pdftocairo/s);
  assert.deepEqual(runner.calls.map((c) => c[0]), ['inkscape', 'gsRepair', 'pdftocairo']);
});

test('auto chain: repair unavailable -> straight to pdftocairo', () => {
  const runner = fakeRunner({ inkscape: 'segfault' }); // gsRepair returns null
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  const r = convertPdf('in.pdf', out, { runner });
  assert.equal(r.converter, 'pdftocairo');
});

test('explicit converter skips the other backends', () => {
  const runner = fakeRunner({ inkscape: 'segfault' });
  const out = join(mkdtempSync(join(tmpdir(), 'conv-')), 'out.svg');
  assert.throws(() => convertPdf('in.pdf', out, { converter: 'inkscape', runner }), /conversion failed/);
  assert.deepEqual(runner.calls.map((c) => c[0]), ['inkscape']);
});

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TROLLEY = join(repo, 'LSB-2607-003-RHC-R00.pdf');
const PDF_009 = join(repo, 'LSB-2609-007-FHL-R00.pdf');

test('availableConverters reports what is installed', () => {
  const ok = availableConverters();
  assert.ok(Array.isArray(ok));
  for (const c of ok) assert.ok(['inkscape', 'gs', 'pdftocairo'].includes(c));
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
