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
import { execFileSync } from 'node:child_process';

import { applyGeometry, parseMatrix } from '../src/templates/geometry.mjs';
import { renderTemplate } from '../src/templates/render.mjs';
import { parseQueryAll } from '../src/templates/authoring.mjs';
import { proposeGeometry, scaffold, reportScaffold, SPAN_TOL } from '../src/eval/scaffold.mjs';
import { renderById } from '../src/templates/renderCmd.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = availableConverters();

// ---------- applyGeometry units ----------

test('stretchX about:"max" pins the far end; the local-origin end tracks', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="bar" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H 5"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['bar'], param: 'dim', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
  ], { dim: '150' });
  assert.equal(report[0].ok, true);
  // ratio 1.5: far end (local x=5) sat at user x 2*5+10=20 and must stay there,
  // so the origin end (translation) tracks by 2*5*(1-1.5).
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 3, b: 0, c: 0, d: 3, e: 5, f: 20 });
});

test('stretchX about:"max" on a negative-extent path pins the far end', () => {
  // The 004 cap-bar shape: local origin at the moving rail, path extending
  // negative — the far end is the local-min end and stays fixed.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="bar" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H -5"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['bar'], param: 'dim', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
  ], { dim: '150' });
  assert.equal(report[0].ok, true);
  // far end (local x=-5) sat at user x 2*-5+10=0 and must stay there; the
  // origin (moving) end tracks by 2*-5*(1-1.5) in +x.
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 3, b: 0, c: 0, d: 3, e: 15, f: 20 });
});

test('stretchY about:"max" pins the far end along y', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="bar" transform="matrix(1,0,0,2,5,6)" d="M 0,0 V 4"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['bar'], param: 'dim', geom: { op: 'stretchY', about: 'max', anchor: 100 } },
  ], { dim: 200 });
  assert.equal(report[0].ok, true);
  // ratio 2: far end (local y=4) sat at user y 2*4+6=14 and must stay there.
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 1, b: 0, c: 0, d: 4, e: 5, f: -2 });
});

test('omitted about renders byte-identical to explicit "min" (today\'s behaviour)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="bar" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H -5"/></svg>';
  const run = (geom) => applyGeometry(svg, [{ ids: ['bar'], param: 'dim', geom }], { dim: '150' }).svg;
  const omitted = run({ op: 'stretchX', anchor: 100 });
  assert.equal(omitted, run({ op: 'stretchX', about: 'min', anchor: 100 }));
  // today's op scales about the local origin: a only, translation untouched.
  assert.equal(omitted, '<svg xmlns="http://www.w3.org/2000/svg"><path id="bar" transform="matrix(3,0,0,3,10,20)" d="M 0,0 H -5"/></svg>');
});

test('unknown about and extent-less elements are reported, never thrown', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="a"/><path id="b" d="M 0,0 H -5"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['a'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
    { ids: ['b'], param: 'd', geom: { op: 'stretchX', about: 'middle', anchor: 100 } },
  ], { d: '150' });
  assert.equal(out, svg, 'failed bindings leave the svg untouched');
  assert.equal(report[0].ok, false);
  assert.match(report[0].reason, /no local extent/);
  assert.equal(report[1].ok, false);
  assert.match(report[1].reason, /unknown about/);
});

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

// ---------- part bindings (#10): span-rule proposal units ----------

// One horizontal dim (line extent 250 px, value 2500) with a left-anchored
// bar (local origin at the datum end) and a right-anchored bar (local origin
// at the moving end, path extending negative — the 004 cap-bar shape).
const partSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="line1" transform="matrix(1,0,0,1,100,200)" d="M 0,0 H 250"/>'
  + '<path id="a1" d="M 0,0 l 8,2 -8,2 z" transform="matrix(1,0,0,1,96,198)"/>'
  + '<path id="a2" d="M 0,0 l -8,2 8,2 z" transform="matrix(1,0,0,1,350,198)"/>'
  + '<path id="barL" transform="matrix(1,0,0,1,98,220)" d="M 0,0 H 246"/>'
  + '<path id="barR" transform="matrix(1,0,0,1,352,230)" d="M 0,0 H -246"/>'
  + '</svg>';
const partRows = [
  { id: 'line1', x: 100, y: 200, w: 250, h: 0.5 },
  { id: 'a1', x: 96, y: 198, w: 8, h: 4 },
  { id: 'a2', x: 346, y: 198, w: 8, h: 4 },
  { id: 'barL', x: 98, y: 220, w: 246, h: 1 },
  { id: 'barR', x: 106, y: 230, w: 246, h: 1 },
];
const partProps = [{ id: 'dim1', value: '2500', geom: { vertical: false, glyphs: [{ id: 't1', x: 205, y: 196 }, { id: 't2', x: 213, y: 196 }] } }];

test('part proposal: elements spanning the dim extent become stretch bindings, about on the datum side', () => {
  const { bindings, parts } = proposeGeometry(partRows, partProps, partSvg);
  const barL = bindings.find((b) => b.ids[0] === 'barL');
  const barR = bindings.find((b) => b.ids[0] === 'barR');
  assert.deepEqual(barL.geom, { op: 'stretchX', about: 'min', anchor: 2500 }, 'origin end sits at the datum plane -> min stays put');
  assert.deepEqual(barR.geom, { op: 'stretchX', about: 'max', anchor: 2500 }, 'origin end at the moving rail -> the far (datum) end stays put');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 2, skipped: 0 }]);
});

test('part proposal: the dim-line cluster is never re-classified as a part', () => {
  const { bindings } = proposeGeometry(partRows, partProps, partSvg);
  assert.equal(bindings.filter((b) => b.ids.includes('line1')).length, 1, 'the dim line binds exactly once (its annotation stretch)');
  const t1 = bindings.filter((b) => b.ids.includes('t1'));
  assert.equal(t1.length, 1, 'a text glyph binds exactly once (its annotation shift)');
  assert.match(t1[0].geom.op, /^shift/);
  assert.ok(!bindings.some((b) => b.ids.includes('a1')), 'the datum-end arrowhead stays unbound, as today');
  assert.ok(!bindings.some((b) => b.geom.op.startsWith('stretch') && b.ids.some((id) => ['a1', 'a2', 't1', 't2'].includes(id))), 'no cluster element gets a stretch part binding');
});

test('part proposal: matching geometry outside the locality box is ignored', () => {
  const rows = [...partRows, { id: 'barFar', x: 100 + 2.6 * 250, y: 220, w: 246, h: 1 }];
  const svg = partSvg + '<path id="barFar" transform="matrix(1,0,0,1,1000,220)" d="M 0,0 H -246"/>';
  const { bindings, parts } = proposeGeometry(rows, partProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('barFar')), 'same span, 2.6 dim extents away -> not a part of this dim');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 2, skipped: 0 }], 'outside the box it is not even a skipped candidate');
});

test('part proposal: one element binds to at most one dimension', () => {
  // dim2 measures the same extent further down; both locality boxes contain
  // the shared bar (centre 300: dim1 box reaches 450, dim2 box reaches 50).
  const rows = [
    ...partRows,
    { id: 'line2', x: 100, y: 400, w: 250, h: 0.5 },
    { id: 'b1', x: 96, y: 398, w: 8, h: 4 },
    { id: 'b2', x: 346, y: 398, w: 8, h: 4 },
    { id: 'bar2', x: 98, y: 620, w: 246, h: 1 },
    { id: 'shared', x: 98, y: 300, w: 246, h: 1 },
  ];
  const svg = partSvg
    + '<path id="line2" transform="matrix(1,0,0,1,100,400)" d="M 0,0 H 250"/>'
    + '<path id="b1" d="M 0,0 l 8,2 -8,2 z" transform="matrix(1,0,0,1,96,398)"/>'
    + '<path id="b2" d="M 0,0 l -8,2 8,2 z" transform="matrix(1,0,0,1,350,398)"/>'
    + '<path id="bar2" transform="matrix(1,0,0,1,98,620)" d="M 0,0 H 246"/>'
    + '<path id="shared" transform="matrix(1,0,0,1,98,300)" d="M 0,0 H 246"/>';
  const props = [...partProps, { id: 'dim2', value: '2500', geom: { vertical: false, glyphs: [{ id: 'u1', x: 205, y: 396 }, { id: 'u2', x: 213, y: 396 }] } }];
  const { bindings, lines, parts } = proposeGeometry(rows, props, svg);
  assert.deepEqual(lines, ['dim1', 'dim2'], 'both annotations still bind');
  const shared = bindings.filter((b) => b.ids.includes('shared'));
  assert.equal(shared.length, 1, 'the shared element binds exactly once');
  assert.equal(shared[0].param, 'dim1', 'first-come dimension wins');
  assert.ok(bindings.some((b) => b.ids.includes('bar2') && b.param === 'dim2'), 'dim2 still binds its own bar');
  const p2 = parts.find((d) => d.param === 'dim2');
  assert.equal(p2.bound, 1);
  assert.equal(p2.skipped, 0, 'the element claimed by dim1 is not a dim2 candidate at all');
});

// ---------- part bindings (#11): attach rule, all-or-nothing ambiguity ----------

// Same dim as the span fixture (extent 250 px = 2500, s = 0.1 px/mm, datum
// plane x=100, moving plane x=350) plus elements attached to each end.
const attachSvg = partSvg
  + '<path id="railBolt" transform="matrix(1,0,0,1,348,240)" d="M 0,0 h 6 v 6 z"/>'
  + '<path id="railPlate" transform="matrix(1,0,0,1,346.5,260)" d="M 0,0 h 20 v 3 z"/>'
  + '<path id="datumBolt" transform="matrix(1,0,0,1,94,236)" d="M 0,0 h 6 v 6 z"/>';
const attachRows = [
  ...partRows,
  { id: 'railBolt', x: 348, y: 240, w: 6, h: 6 },
  { id: 'railPlate', x: 346.5, y: 260, w: 20, h: 3 },
  { id: 'datumBolt', x: 94, y: 236, w: 6, h: 6 },
];

test('part proposal: moving-end attachments shift at the full rate; datum-side stays unbound', () => {
  const { bindings, parts } = proposeGeometry(attachRows, partProps, attachSvg);
  for (const id of ['railBolt', 'railPlate']) {
    const b = bindings.find((x) => x.ids[0] === id);
    assert.ok(b, `${id} bound`);
    assert.deepEqual(b.geom, { op: 'shiftX', anchor: 2500, pxPerUnit: 0.1 }, 'full rate: the dim\'s own extent/value');
  }
  assert.ok(!bindings.some((b) => b.ids.includes('datumBolt')), 'datum-side attachments stay unbound');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 4, skipped: 1 }], '2 spans + 2 attachments; the datum bolt is a skipped candidate');
  // rendered behaviour: the attachment moves by (value - anchor) * pxPerUnit
  const shift = bindings.filter((b) => b.geom.op === 'shiftX' && b.ids[0] !== 'a2' && !b.ids.includes('t1'));
  const { svg: out } = applyGeometry(attachSvg, shift, { dim1: '3000' });
  assert.deepEqual(parseMatrix(out.match(/<path\b[^>]*\bid="railBolt"[^>]*transform="([^"]*)"/)[1]),
    { a: 1, b: 0, c: 0, d: 1, e: 398, f: 240 }, '(3000 - 2500) * 0.1 = 50 user units');
  const datum = parseMatrix(out.match(/<path\b[^>]*\bid="datumBolt"[^>]*transform="([^"]*)"/)[1]);
  assert.equal(datum.e, 94, 'datum-side element untouched by the render');
});

test('part proposal: an element overlapping both ends forfeits the whole dim (all-or-nothing)', () => {
  const rows = [...partRows, { id: 'overlapBar', x: 70, y: 220, w: 310, h: 2 }];
  const svg = partSvg + '<path id="overlapBar" transform="matrix(1,0,0,1,70,220)" d="M 0,0 H 310"/>';
  const { bindings, parts } = proposeGeometry(rows, partProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('barL') || b.ids.includes('barR') || b.ids.includes('overlapBar')), 'nothing binds for the dim');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 0, skipped: 1, ambiguous: true }]);
  assert.ok(bindings.some((b) => b.ids.includes('line1') && b.geom.op === 'stretchX'), 'the annotation proposal is unaffected');
});

test('part proposal: non-axis-aligned geometry in the box is ambiguous (all-or-nothing)', () => {
  const rows = [...partRows, { id: 'tilted', x: 200, y: 300, w: 10, h: 10 }];
  const svg = partSvg + '<path id="tilted" transform="matrix(0.7071,0.7071,-0.7071,0.7071,200,300)" d="M 0,0 H 10"/>';
  const { bindings, parts } = proposeGeometry(rows, partProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('barL') || b.ids.includes('barR')), 'nothing binds for the dim');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 0, skipped: 1, ambiguous: true }]);
});

test('reportScaffold marks an ambiguous dimension "skipped: ambiguous"', () => {
  const lines = [];
  reportScaffold({
    id: 'x', dir: '/tmp/x', outlines: 0, props: [], geomLines: 1, preserved: 0,
    parts: [{ param: 'dim2', bound: 0, skipped: 1, ambiguous: true }],
    vision: { called: false, dims: 0, rejected: 0 }, editor: 'e.html', editorMB: '0.1',
  }, (l) => lines.push(l));
  const row = lines.find((l) => l.includes('dim2'));
  assert.ok(row, `expected a per-dim parts row, got:\n${lines.join('\n')}`);
  assert.match(row, /0 bound, skipped: ambiguous/);
});

test('reportScaffold prints per-dimension part bound/skipped counts', () => {
  const lines = [];
  reportScaffold({
    id: 'x', dir: '/tmp/x', outlines: 0, props: [], geomLines: 1, preserved: 0,
    parts: [{ param: 'dim1', bound: 4, skipped: 2 }],
    vision: { called: false, dims: 0, rejected: 0 }, editor: 'e.html', editorMB: '0.1',
  }, (l) => lines.push(l));
  const row = lines.find((l) => l.includes('dim1') && l.includes('bound'));
  assert.ok(row, `expected a per-dim parts row, got:\n${lines.join('\n')}`);
  assert.match(row, /4 bound, 2 skipped/);
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

// ---------- real art: right-anchored cap bar of the 004 template ----------

test('about:"max" on the 004 cap bar: far end stays fixed, moving end tracks', () => {
  const base = readFileSync(join(repo, 'templates/lsb-2607-004-fhl-r00/base.clean.svg'), 'utf8');
  // Measured from base.clean.svg: path4307 is a cap-bar edge, right-anchored —
  // local origin at the moving rail (user x=163.09), path "M 0,0 H -27.865"
  // extending negative to the datum rail. dim1 anchor 500.
  const re = /<path\b[^>]*\bid="path4307"[^>]*transform="([^"]*)"/;
  const barM = parseMatrix(base.match(re)[1]);
  const extent = -27.865;
  const ratio = 1000 / 500;
  const bind = (geom) => applyGeometry(base, [{ ids: ['path4307'], param: 'dim1', geom }], { dim1: '1000' });
  const { svg: out, report } = bind({ op: 'stretchX', about: 'max', anchor: 500 });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  const m = parseMatrix(out.match(re)[1]);
  assert.ok(Math.abs(m.a - barM.a * ratio) < 1e-4, 'bar stretched by value ratio');
  // pinned far end: user position of the local-min end unchanged (1e-3: the
  // transform is re-serialised at 5 decimals)
  const far = (mm) => mm.a * extent + mm.e;
  assert.ok(Math.abs(far(m) - far(barM)) < 1e-3, `far end ${far(barM)} -> ${far(m)}`);
  // tracking origin end: translation moved by a*extent*(1-ratio), i.e. the bar
  // grew by its own extent share of the ratio
  assert.ok(Math.abs(m.e - (barM.e + barM.a * extent * (1 - ratio))) < 1e-3, 'moving end tracks value/anchor');
  // omitted about is today's behaviour exactly: a scales, translation untouched
  const { svg: dflt } = bind({ op: 'stretchX', anchor: 500 });
  const md = parseMatrix(dflt.match(re)[1]);
  assert.ok(Math.abs(md.a - barM.a * ratio) < 1e-4);
  assert.equal(md.e, barM.e, 'omitted about keeps the origin end pinned');
});

// ---------- #10 real art: dim1 of 004 binds the cap bars, not the rungs ----------

const CAP_BARS = ['path4307', 'path4308', 'path4309', 'path4310'];
const RUNGS = ['path4324', 'path4325', 'path4328', 'path4329'];

test('part proposal on 004 art: dim1 spans the cap bars (right-anchored, about max) and leaves the rungs', { skip: !tools.includes('inkscape') && 'requires inkscape' }, () => {
  const dir = join(repo, 'templates/lsb-2607-004-fhl-r00');
  const base = readFileSync(join(dir, 'base.clean.svg'), 'utf8');
  const rows = parseQueryAll(execFileSync('inkscape', ['--query-all', join(dir, 'base.clean.svg')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  // Measured from base.clean.svg: dim1 line is path1463 (extent 39.9973 px for
  // 500 mm, left-anchored at x=124.517); its text is text1465…text1470.
  const props = [{ id: 'dim1', value: '500', geom: { vertical: false, glyphs: [
    { id: 'text1465', x: 127.806, y: 72.4074 }, { id: 'text1466', x: 134.327, y: 72.3315 },
    { id: 'text1467', x: 140.856, y: 72.3315 }, { id: 'text1468', x: 147.444, y: 76.7074 },
    { id: 'text1469', x: 150.913, y: 72.3315 }, { id: 'text1470', x: 157.44, y: 72.3315 },
  ] } }];
  const { bindings, parts } = proposeGeometry(rows, props, base);
  for (const id of CAP_BARS) {
    const b = bindings.find((x) => x.ids.includes(id));
    assert.ok(b, `${id} bound`);
    assert.equal(b.param, 'dim1');
    assert.equal(b.geom.op, 'stretchX');
    assert.equal(b.geom.about, 'max', `${id} is right-anchored: the far (datum) end stays put`);
    assert.equal(b.geom.anchor, 500);
  }
  const d1 = parts.find((d) => d.param === 'dim1');
  // Measured from the art: 4 cap-bar edges span the dim, and 82 elements of
  // the moving-end rail assembly attach to the moving plane (path4461 rail
  // segment, path4279 bracket plate, the path20xx/21xx bolt and hatch marks,
  // path8127-8136 rail pieces).
  assert.equal(d1.bound, 86, `4 spans + 82 attachments, got bound=${d1.bound} skipped=${d1.skipped}`);
  assert.ok(!d1.ambiguous);
  assert.ok(d1.skipped >= 1, 'look-alike geometry in the box (path1476/platform edge, path1509, texts, extension lines) is counted as skipped');
  for (const id of ['path4461', 'path4279']) {
    const b = bindings.find((x) => x.ids.includes(id));
    assert.ok(b, `${id} (moving-end rail assembly) bound`);
    assert.equal(b.geom.op, 'shiftX', 'attach rule: shift at the full rate');
    assert.equal(b.geom.pxPerUnit, 0.0799946, "the dim's own extent/value");
    assert.equal(b.geom.anchor, 500);
  }
  assert.ok(!bindings.some((b) => ['path4321', 'path7808', 'path4304'].some((id) => b.ids.includes(id))), 'the datum-side rail, plate and bar ends stay unbound');
  assert.ok(!bindings.some((b) => b.ids.some((id) => RUNGS.includes(id))), 'ladder-body rungs (56.6 px vs the 40.0 px dim extent) stay unbound');
  assert.ok(!bindings.some((b) => b.ids.some((id) => ['path1476', 'path1509'].includes(id))), 'same-length geometry offset along the axis does not span THIS dim');
});

// ---------- editor port parity ----------

test('editor inline engine applies identical geometry ops (port parity)', () => {
  const tplHtml = readFileSync(join(repo, 'src/templates/editor.template.html'), 'utf8');
  const script = tplHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const geomSrc = script.slice(script.indexOf('// L2 geometry'), script.indexOf('function render('));
  const { applyGeometry: applyGeometryInline } = new Function(`${geomSrc}\nreturn { applyGeometry };`)();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<path id="p1" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H 5"/>'
    + '<path id="p2" transform="matrix(1.3333333,0,0,-1.3333333,163.09173,95.326267)" d="M 0,0 H -27.865"/>'
    + '<path id="p3" transform="matrix(1,0,0,2,5,6)" d="M 0,0 V 4"/>'
    + '<path id="t"/></svg>';
  const bindings = [
    { ids: ['p1'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
    { ids: ['p2'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 500 } },
    { ids: ['p3'], param: 'd', geom: { op: 'stretchY', about: 'max', anchor: 100 } },
    { ids: ['p1'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.5 } },
    { ids: ['t'], param: 'd', geom: { op: 'stretchX', anchor: 100 } },
    { ids: ['missing'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
    { ids: ['p2'], param: 'd', geom: { op: 'stretchX', about: 'middle', anchor: 500 } },
  ];
  for (const params of [{ d: '150' }, { d: '3,500' }, { d: 'abc' }]) {
    const cli = applyGeometry(svg, bindings, params);
    const ed = applyGeometryInline(svg, bindings, params);
    // the editor report rows are a reduced port (no ratio/reasons) — the
    // rendered svg must be identical and ok flags must match.
    assert.equal(ed.svg, cli.svg, `svg identical for d=${params.d}`);
    assert.deepEqual(ed.report.map((r) => r.ok), cli.report.map((r) => r.ok), `ok flags for d=${params.d}`);
  }
});

// ---------- 1C.7 acceptance: author from one PDF, geometry tracks ----------

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

// ---------- #10/#11 acceptance: re-scaffolded 004 widens the cap consistently ----------

test('#11 e2e: re-scaffolded 004 -> dim1=1000 widens the cap; bars land on the shifted rail', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-parts-'));
  const r = await scaffold(join(repo, 'LSB-2607-004-FHL-R00.pdf'), { llm: false, id: 'geo-004', templatesDir: tmp });
  const d1 = r.parts.find((d) => d.param === 'dim1');
  // 4 cap bars span the dim; 82 elements of the moving-end rail assembly
  // (rail segments, bracket plates, bolts) attach to the moving plane.
  assert.ok(d1 && d1.bound === 86, `dim1 proposes the cap bars + rail assembly, got ${JSON.stringify(r.parts)}`);
  assert.ok(!d1.ambiguous);

  const tpl = JSON.parse(readFileSync(join(tmp, 'geo-004', 'template.json'), 'utf8'));
  for (const id of CAP_BARS) {
    const b = tpl.bindings.find((x) => (x.ids || []).includes(id));
    assert.ok(b?.geom, `${id} has a geom binding`);
    assert.equal(b.param, 'dim1');
    assert.equal(b.geom.op, 'stretchX');
    assert.equal(b.geom.about, 'max', 'right-anchored bars pin the datum-side far end');
    assert.equal(b.geom.anchor, 500);
  }
  assert.ok(!tpl.bindings.some((b) => (b.ids || []).some((id) => RUNGS.includes(id))), 'rungs never bind');

  // #11 attach rule: the moving-end rail assembly shifts at the full rate;
  // the datum-side rail and its attachments stay unbound.
  const RAIL_SIDE = ['path4461', 'path4279'];
  const tagRe = (id) => new RegExp(`<[a-zA-Z][^>]*?\\bid="${id}"[^>]*transform="([^"]*)"`);
  for (const id of RAIL_SIDE) {
    const b = tpl.bindings.find((x) => (x.ids || []).includes(id));
    assert.ok(b?.geom, `${id} (moving-end rail assembly) has a geom binding`);
    assert.equal(b.param, 'dim1');
    assert.equal(b.geom.op, 'shiftX');
    assert.equal(b.geom.pxPerUnit, 0.0799946, "full rate: the dim's own extent/value");
    assert.equal(b.geom.anchor, 500);
  }
  for (const id of ['path4321', 'path7808', 'path4304']) {
    assert.ok(!tpl.bindings.some((b) => (b.ids || []).includes(id)), `${id} (datum side) never binds`);
  }

  // render with dim1 = 1000: every cap bar doubles in width, the datum-side
  // end stays pinned, the moving (rail) end tracks the value, and the rail
  // assembly shifts by (value - anchor) * pxPerUnit so the widened bars still
  // land on it.
  const out = renderById(tmp, 'geo-004', { dim1: '1000' });
  assert.ifError(out.error);
  const clean = readFileSync(join(tmp, 'geo-004', 'base.clean.svg'), 'utf8');
  const s = 0.0799946;
  for (const id of CAP_BARS) {
    const before = parseMatrix(clean.match(tagRe(id))[1]);
    const after = parseMatrix(out.svg.match(tagRe(id))[1]);
    const ratio = 1000 / 500;
    assert.ok(Math.abs(after.a - before.a * ratio) < 1e-3, `${id} widened by value ratio`);
    // local extent "M 0,0 H -27.865": the datum end is the local-min end.
    const far = (m) => m.a * -27.865 + m.e;
    assert.ok(Math.abs(far(after) - far(before)) < 1e-2, `${id} datum end stays pinned`);
    assert.ok(Math.abs(after.e - (before.e + before.a * -27.865 * (1 - ratio))) < 1e-2, `${id} moving end tracks`);
    const rungRe = new RegExp(`<[a-zA-Z][^>]*?\\bid="path4324"[^>]*transform="([^"]*)"`);
    assert.equal(out.svg.match(rungRe)[1], clean.match(rungRe)[1], 'rung untouched by the render');
  }
  for (const id of RAIL_SIDE) {
    const before = parseMatrix(clean.match(tagRe(id))[1]);
    const after = parseMatrix(out.svg.match(tagRe(id))[1]);
    assert.ok(Math.abs((after.e - before.e) - (1000 - 500) * s) < 1e-2, `${id} shifts by (value - anchor) * pxPerUnit`);
  }
  // The bars land on the shifted-rail position only within the tolerance the
  // span rule admitted them with: ±SPAN_TOL of the dim extent (≈4px — the art
  // insets the bar ends ~1.4px inside the rail plane), grown by the value
  // ratio as the inset scales with the edit. Exact landing would require art
  // whose bars terminate exactly on the rail plane; ±10% span tolerance
  // cannot guarantee that.
  const bar = parseMatrix(out.svg.match(tagRe('path4307'))[1]);
  const plate = parseMatrix(out.svg.match(tagRe('path4279'))[1]);
  const cleanPlate = parseMatrix(clean.match(tagRe('path4279'))[1]);
  const PLATE_NEAR = 163.385;           // path4279 bbox near edge (measured)
  const barEnd = bar.e + 0.327;         // stroke half-width: bbox edge of the bar end
  const admitted = SPAN_TOL * (s * 500) * (1000 / 500);
  assert.ok(Math.abs(barEnd - (plate.e - cleanPlate.e + PLATE_NEAR)) < admitted,
    `bar end ${barEnd.toFixed(2)} lands on the shifted plate ${(plate.e - cleanPlate.e + PLATE_NEAR).toFixed(2)} within ±SPAN_TOL×extent×ratio (${admitted.toFixed(1)})`);

  // the annotation reads 1000. Glyph ids are conversion-specific (the
  // glyph-merge collapses per-character texts), so derive the fresh id.
  const annId = r.props.find((p) => p.id === 'dim1').geom.glyphs[0].id;
  const ann = out.svg.match(new RegExp(`<text\\b[^>]*?\\bid="${annId}"[^>]*>[\\s\\S]*?<\\/text>`))[0];
  assert.ok(ann.includes('>1000<'), 'the dim1 annotation reads 1000');
  // FLATBAR callouts (labels + leader) are untouched by the whole edit:
  // nothing outside the bound id set may move.
  const tf = (svg) => { const m = {}; for (const x of svg.matchAll(/<[a-zA-Z][\w:-]*[^>]*?\bid="([^"]+)"[^>]*?\btransform="([^"]*)"/g)) m[x[1]] = x[2]; return m; };
  const tClean = tf(clean), tOut = tf(out.svg);
  const boundIds = new Set(tpl.bindings.flatMap((b) => b.ids || []));
  for (const id of Object.keys(tClean)) {
    if (tClean[id] !== tOut[id]) assert.ok(boundIds.has(id), `${id} moved but is not bound`);
  }
});
