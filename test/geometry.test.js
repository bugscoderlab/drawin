// L2 geometry tests (PLAN 1C.7): rendering moves dimension lines so they track
// the value, scaffold auto-proposes geometry bindings from the drawing's own
// structure, and a template authored from a real PDF re-renders with both the
// new value AND the moved geometry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyGeometry, parseMatrix } from '../src/templates/geometry.mjs';
import { renderTemplate } from '../src/templates/render.mjs';
import { proposeGeometry, scaffold } from '../src/eval/scaffold.mjs';
import { renderById } from '../src/templates/renderCmd.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- applyGeometry units ----------

test('stretchX scales the matrix about the local origin by value/anchor', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="line" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H 5"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['line'], param: 'dim', geom: { op: 'stretchX', anchor: 100 } },
  ], { dim: '150' });
  assert.equal(report[0].ok, true);
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 3, b: 0, c: 0, d: 3, e: 10, f: 20 });
});

test('stretchY scales d; shiftY translates by (value-anchor)*pxPerUnit', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="l" transform="matrix(1,0,0,2,5,6)"/><path id="t"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['l'], param: 'dim', geom: { op: 'stretchY', anchor: 100 } },
    { ids: ['t'], param: 'dim', geom: { op: 'shiftY', anchor: 100, pxPerUnit: 0.5 } },
  ], { dim: 200 });
  assert.ok(report.every((r) => r.ok));
  const [l, t] = [...out.matchAll(/transform="([^"]*)"/g)].map((m) => parseMatrix(m[1]));
  assert.deepEqual(l, { a: 1, b: 0, c: 0, d: 4, e: 5, f: 6 });          // stretched about origin
  assert.deepEqual(t, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 50 });          // translate added where missing
});

test('comma values parse; bad input reports instead of throwing', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="a"/><path id="b"/></svg>';
  const { report } = applyGeometry(svg, [
    { ids: ['a'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.1 } },
    { ids: ['b'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.1 } },
    { ids: ['nope'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.1 } },
  ], { d: '3,500' });
  assert.equal(report[0].ok, true, 'comma number ok');
  const { report: r2 } = applyGeometry(svg, [
    { ids: ['a'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.1 } },
  ], { d: '0' });
  assert.equal(r2[0].ok, false);
  assert.equal(report[2].ok, false);
  assert.match(report[2].reason, /id not found/);
});

// ---------- proposeGeometry units ----------

const syntheticSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="line1" transform="matrix(1,0,0,1,100,200)" d="M 0,0 H 250"/>'
  + '<path id="a1" d="M 0,0 l 8,2 -8,2 z" transform="matrix(1,0,0,1,96,198)"/>'
  + '<path id="a2" d="M 0,0 l -8,2 8,2 z" transform="matrix(1,0,0,1,350,198)"/>'
  + '<path id="lineNoArrows" transform="matrix(1,0,0,1,100,230)" d="M 0,0 H 260"/>'
  + '</svg>';

test('proposeGeometry finds the arrowed dimension line, not bare lines', () => {
  const rows = [
    { id: 'line1', x: 100, y: 200, w: 250, h: 0.5 },
    { id: 'a1', x: 96, y: 198, w: 8, h: 4 },
    { id: 'a2', x: 346, y: 198, w: 8, h: 4 },
    { id: 'lineNoArrows', x: 100, y: 230, w: 260, h: 0.5 },
  ];
  const props = [{ id: 'dim1', value: '2500', geom: { vertical: false, glyphs: [{ id: 't1', x: 205, y: 196 }, { id: 't2', x: 213, y: 196 }] } }];
  const { bindings, lines } = proposeGeometry(rows, props, syntheticSvg);
  assert.deepEqual(lines, ['dim1']);
  const stretch = bindings.find((b) => b.geom.op === 'stretchX');
  assert.deepEqual(stretch.ids, ['line1']);
  assert.equal(stretch.geom.anchor, 2500);
  const arrow = bindings.find((b) => b.geom.op === 'shiftX' && b.ids[0] === 'a2');
  assert.ok(arrow, 'far-end arrowhead moves (origin end is the datum)');
  assert.equal(arrow.geom.pxPerUnit, 250 / 2500);
  assert.ok(!bindings.some((b) => b.ids.includes('a1')), 'datum-end arrowhead stays');
  const text = bindings.find((b) => b.ids.includes('t1'));
  assert.equal(text.geom.pxPerUnit, 250 / 2500 / 2, 'text re-centres at half rate');
});

test('proposeGeometry skips implausible scales and claims lines once', () => {
  const rows = [
    { id: 'line1', x: 100, y: 200, w: 250, h: 0.5 },
    { id: 'a1', x: 96, y: 198, w: 8, h: 4 },
    { id: 'a2', x: 346, y: 198, w: 8, h: 4 },
  ];
  const huge = [{ id: 'dim1', value: '10', geom: { vertical: false, glyphs: [{ id: 't1', x: 205, y: 196 }] } }];
  assert.deepEqual(proposeGeometry(rows, huge, syntheticSvg).lines, [], 's=25 px/mm rejected');
});

// ---------- real art: the footprint dimension of the trolley template ----------

test('L2 on real art: footprint line stretches and text stays centred', () => {
  const base = readFileSync(join(repo, 'templates/trolley-slt/base.clean.svg'), 'utf8');
  // Measured from base.clean.svg: the 2372 dimension line is path1479
  // ("M 0,0 H 192.503" × matrix a=1.3333333 -> 256.67 px for 2372 mm).
  const lineM = parseMatrix(base.match(/<path\b[^>]*\bid="path1479"[^>]*transform="([^"]*)"/)[1]);
  const extent = 1.3333333 * 192.503;
  const s = extent / 2372;
  const bindings = [
    { value: '2372', param: 'footprint', mode: 'group' },
    { ids: ['path1479'], param: 'footprint', geom: { op: 'stretchX', anchor: 2372 } },
    { ids: ['path1478'], param: 'footprint', geom: { op: 'shiftX', anchor: 2372, pxPerUnit: s } },
    { ids: ['text1481', 'text1482', 'text1483', 'text1484'], param: 'footprint', geom: { op: 'shiftX', anchor: 2372, pxPerUnit: s / 2 } },
  ];
  const { svg, report } = renderTemplate(base, bindings, { footprint: '3200' });
  assert.ok(report.every((r) => r.ok), JSON.stringify(report.filter((r) => !r.ok)));
  assert.ok(svg.includes('3200'), 'new value appears');
  const ratio = 3200 / 2372;
  const newLine = parseMatrix(svg.match(/<path\b[^>]*\bid="path1479"[^>]*transform="([^"]*)"/)[1]);
  assert.ok(Math.abs(newLine.a - lineM.a * ratio) < 1e-4, 'line stretched by value ratio');
  assert.equal(newLine.e, lineM.e, 'datum end stays put');
  const arrow = parseMatrix(svg.match(/<path\b[^>]*\bid="path1478"[^>]*transform="([^"]*)"/)[1]);
  assert.ok(Math.abs(arrow.e - (402.07027 + (3200 - 2372) * s)) < 0.05, 'far arrowhead follows the line');
  const t1481 = parseMatrix(svg.match(/<text\b[^>]*\bid="text1481"[^>]*transform="([^"]*)"/)[1]);
  assert.ok(Math.abs(t1481.e - (259.79947 + (3200 - 2372) * s / 2)) < 0.05, 'text group re-centred');
});

// ---------- 1C.7 acceptance: author from one PDF, geometry tracks ----------

const tools = availableConverters();
test('1C.7 e2e: scaffold the trolley PDF -> geometry bindings -> render tracks', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-geom-'));
  const r = await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm: false, id: 'geo-trolley', templatesDir: tmp });
  assert.ok(r.geomLines >= 1, `expected geometry lines, got ${r.geomLines}`);

  const tpl = JSON.parse(readFileSync(join(tmp, 'geo-trolley', 'template.json'), 'utf8'));
  const stretches = tpl.bindings.filter((b) => b.geom?.op?.startsWith('stretch'));
  assert.ok(stretches.length >= 1, 'at least one stretch binding proposed');

  const out = renderById(tmp, 'geo-trolley', tpl.sample);
  assert.ifError(out.error);
  assert.ok(out.report.filter((b) => !b.ok).length === 0, JSON.stringify(out.report.filter((b) => !b.ok)));
  const clean = readFileSync(join(tmp, 'geo-trolley', 'base.clean.svg'), 'utf8');
  for (const b of stretches) {
    const v = parseFloat(String(tpl.sample[b.param] ?? tpl.params.find((p) => p.id === b.param)?.default).replace(/,/g, ''));
    const anchor = b.geom.anchor;
    for (const id of b.ids) {
      const re = new RegExp(`<[a-zA-Z][^>]*?\\bid="${id}"[^>]*transform="([^"]*)"`);
      const before = parseMatrix(clean.match(re)[1]);
      const after = parseMatrix(out.svg.match(re)[1]);
      const axis = b.geom.op === 'stretchX' ? 'a' : 'd';
      const ratio = v / anchor;
      assert.ok(Math.abs(after[axis] - before[axis] * ratio) < Math.abs(before[axis] * ratio) * 0.01 + 1e-4,
        `${id} ${b.geom.op}: ${before[axis]} -> ${after[axis]}, expected ~${before[axis] * ratio}`);
    }
  }
});
