// `ladder render` tests: L1 art templates re-render with changed values,
// L3 code models render through the core, misuse throws with a helpful list,
// and the browser manifest (templates/index.js) stays in sync with the registry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { renderById, splitSvgDocument, toDocument } from '../src/templates/renderCmd.mjs';
import { loadRegistry } from '../src/templates/registry.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(repo, 'templates');

test('L1: sample values re-render the real art (customer + footprint)', () => {
  const r = renderById(TEMPLATES, 'trolley-slt', {
    customer: 'ACME TOWER CRANES SDN BHD',
    drawingNo: 'LSB-2607-999/ACME/R03',
    footprint: '3200',
  });
  assert.ifError(r.error);
  assert.ok(r.svg.startsWith('<svg xmlns='), 'standalone SVG document');
  assert.ok(r.svg.includes('ACME TOWER CRANES SDN BHD'));
  assert.ok(r.svg.includes('LSB-2607-999/ACME/R03'));
  assert.equal(r.report.filter((b) => !b.ok).length, 0, 'all bindings applied');
});

test('L1: no values -> template defaults apply, output is valid SVG', () => {
  const r = renderById(TEMPLATES, 'trolley-slt', {});
  assert.ok(r.svg.includes('RAHABCO ENGINEERING &amp; CONSTRUCTION SDN BHD')
    || r.svg.includes('RAHABCO ENGINEERING & CONSTRUCTION SDN BHD'));
  const parts = splitSvgDocument(r.svg);
  assert.match(parts.viewBox, /^0 0 /);
  assert.ok(parts.inner.length > 1000, 'has drawing content');
});

test('L3: code model renders through the core with overrides', () => {
  const r = renderById(TEMPLATES, 'trolley-l3', { steps: 12, customer: 'TEST CUSTOMER SDN BHD' });
  assert.ifError(r.error);
  assert.ok(r.svg.includes('12 STEP'));
  assert.ok(r.svg.includes('TEST CUSTOMER'));
});

test('L3: invalid model returns { error }, never throws', () => {
  const r = renderById(TEMPLATES, 'cage-l3', { cageRings: 30, cageHeight: 1000 });
  assert.ok(r.error);
});

test('unknown id throws with the available list (CLI misuse, not an unmatched drawing)', () => {
  assert.throws(() => renderById(TEMPLATES, 'nope'), /unknown template "nope"/);
  assert.throws(() => renderById(TEMPLATES, 'nope'), /trolley-slt/);
});

test('splitSvgDocument/toDocument round-trip', () => {
  const doc = '<?xml version="1.0"?>\n<!-- c -->\n<svg width="100" height="50" viewBox="0 0 100 50"><rect width="9" height="9"/></svg>\n';
  const p = splitSvgDocument(doc);
  assert.equal(p.viewBox, '0 0 100 50');
  assert.equal(p.width, '100');
  assert.ok(p.inner.includes('<rect'));
  assert.equal(toDocument(p.inner, p), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><rect width="9" height="9"/></svg>');
});

test('manifest (templates/index.js) matches the registry', () => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(join(TEMPLATES, 'index.js'), 'utf8'), sandbox);
  const manifest = JSON.parse(JSON.stringify(sandbox.LADDER_TEMPLATES)); // strip vm prototypes
  const { templates, errors } = loadRegistry(TEMPLATES, { withL3: false });
  assert.deepEqual(errors, []);
  assert.deepEqual(manifest.map((t) => t.id).sort(), templates.map((t) => t.id).sort());
  for (const t of manifest) {
    assert.ok(Array.isArray(t.params) && Array.isArray(t.bindings), `${t.id}: params+bindings for Template mode`);
    assert.ok(t.base?.svg, `${t.id}: base svg path for fetching`);
  }
});
