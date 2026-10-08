// Phase 0 acceptance: render each module at defaults and snapshot the SVG.
// Also proves the browser bundle (src/core/ladder-core.js) renders byte-identical
// output to the ESM sources it was built from.
//
//   node --test                     run tests
//   UPDATE_SNAPSHOTS=1 node --test  regenerate fixtures (after an intentional change)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { renderSVG, renderDocument } from '../src/core/render.mjs';
import { paramsFor } from '../src/core/modules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const FIXED_DATE = { date: '08-10-2026' }; // cat/trolley stamp "today" — pin it for determinism

// Load the browser bundle exactly as a browser would: classic script → global.
const sandbox = {};
vm.runInNewContext(readFileSync(join(here, '..', 'src', 'core', 'ladder-core.js'), 'utf8'), sandbox);
const Bundle = sandbox.LadderCore;

assert.ok(Bundle, 'ladder-core.js must define the LadderCore global');
assert.equal(typeof Bundle.renderSVG, 'function', 'bundle must expose renderSVG');

for (const module of ['cat', 'cage', 'trolley']) {
  test(`${module}: renders at defaults, bundle === ESM`, () => {
    const params = paramsFor(module);
    const esm = renderSVG(module, params, FIXED_DATE);
    const umd = Bundle.renderSVG(module, params, FIXED_DATE);

    assert.ifError(esm.error);
    assert.equal(umd.svg, esm.svg, 'bundle output must equal ESM output');
    assert.match(esm.svg, /<svg|./); // non-empty
    assert.match(esm.viewBox, /^0 0 \d+ \d+$/);

    const file = join(fixtureDir, `${module}.svg`);
    if (UPDATE || !existsSync(file)) {
      mkdirSync(fixtureDir, { recursive: true });
      const doc = renderDocument(module, params, FIXED_DATE);
      writeFileSync(file, doc.document + '\n');
    }
    const expected = readFileSync(file, 'utf8');
    const actual = renderDocument(module, params, FIXED_DATE).document + '\n';
    assert.equal(actual, expected, `${module} output drifted from fixture (intentional? re-run with UPDATE_SNAPSHOTS=1)`);
  });
}

test('cage: invalid params produce an error, not an exception', () => {
  const bad = renderSVG('cage', { ...paramsFor('cage'), cageRings: 30, cageHeight: 1000 }, FIXED_DATE);
  assert.ok(bad.error);
  const empty = renderSVG('cage', { ...paramsFor('cage'), cageWidth: '' }, FIXED_DATE);
  assert.match(empty.error, /Ladder outside width/);
});

test('rendered title block carries the parameters', () => {
  const p = { ...paramsFor('cat'), customer: 'ACME & SONS', drawingNo: 'LSB/1' };
  const r = renderSVG('cat', p, FIXED_DATE);
  assert.ok(r.svg.includes('ACME &amp; SONS'), 'customer must be XML-escaped into the SVG');
});
