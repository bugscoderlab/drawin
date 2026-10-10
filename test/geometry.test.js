// L2 geometry tests (PLAN 1C.7): rendering moves dimension lines so they track
// the value, scaffold auto-proposes geometry bindings from the drawing's own
// structure, and a template authored from a real PDF re-renders with both the
// new value AND the moved geometry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { applyGeometry, parseMatrix, localAxis } from '../src/templates/geometry.mjs';
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

// ---------- axial ops (#21): rotated elements stretch/shift along their own axis ----------

// Hand-computed fixture: a=6,b=8 (|axis|=10, unit (0.6,0.8)), c=0,d=5,e=10,f=20.
const ROT = '<path id="s" transform="matrix(6,8,0,5,10,20)" d="M 0,0 H 40"/>';
const ROT_NEG = '<path id="s" transform="matrix(6,8,0,5,10,20)" d="M 0,0 H -40"/>';
const axialSvg = (path) => `<svg xmlns="http://www.w3.org/2000/svg">${path}</svg>`;

test('stretchAxial about:"max" pins the far end of a rotated element', () => {
  const { svg: out, report } = applyGeometry(axialSvg(ROT), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'max', anchor: 200 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // ratio 1.5: the whole (a,b) column scales (angle preserved). Far end is
  // local x=40, |hi|=40 > |lo|=0. Its user position before: (6*40+10, 8*40+20)
  // = (250, 340) and must stay there:
  //   e' = 10 + 6*40*(1-1.5) = -110,  f' = 20 + 8*40*(1-1.5) = -140
  // check: (9*40-110, 12*40-140) = (250, 340) — pinned.
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 9, b: 12, c: 0, d: 5, e: -110, f: -140 });
});

test('stretchAxial about:"max" on a rotated negative-extent path pins the far end', () => {
  const { svg: out, report } = applyGeometry(axialSvg(ROT_NEG), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'max', anchor: 200 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // ratio 1.5: far end is local x=-40 (|lo|=40 > |hi|=0), user position
  // (6*-40+10, 8*-40+20) = (-230, -300) and must stay there:
  //   e' = 10 + 6*-40*(1-1.5) = 130,  f' = 20 + 8*-40*(1-1.5) = 180
  // check: (9*-40+130, 12*-40+180) = (-230, -300) — pinned.
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 9, b: 12, c: 0, d: 5, e: 130, f: 180 });
});

test('stretchAxial about:"min" keeps the local origin fixed and preserves the angle', () => {
  const { svg: out, report } = applyGeometry(axialSvg(ROT), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'min', anchor: 200 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // about "min" pins the local-origin end (p0=0): translation untouched, the
  // (a,b) column scales by the ratio. Local end x=40 rides the axis:
  // before (250,340) -> after (9*40+10, 12*40+20) = (370,500), i.e. 1.5x
  // further along the SAME unit direction (0.6,0.8): (250-10,340-20)*0.5 = (120,160).
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 9, b: 12, c: 0, d: 5, e: 10, f: 20 });
  // omitted about is exactly explicit "min"
  const { svg: dflt } = applyGeometry(axialSvg(ROT), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', anchor: 200 } },
  ], { dim: '300' });
  assert.equal(dflt, out);
});

test('stretchAxial with b=0 renders byte-identical to stretchX (both about values, both extent signs)', () => {
  for (const d of ['M 0,0 H 5', 'M 0,0 H -5']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path id="x" transform="matrix(2,0,0,3,10,20)" d="${d}"/></svg>`;
    for (const about of [undefined, 'min', 'max']) {
      const geom = { op: 'stretchX', about, anchor: 100 };
      const geomAxial = { op: 'stretchAxial', about, anchor: 100 };
      const cli = applyGeometry(svg, [{ ids: ['x'], param: 'dim', geom }], { dim: '150' });
      const ax = applyGeometry(svg, [{ ids: ['x'], param: 'dim', geom: geomAxial }], { dim: '150' });
      assert.equal(ax.svg, cli.svg, `d="${d}" about=${about}`);
      assert.deepEqual(ax.report.map((r) => r.ok), cli.report.map((r) => r.ok));
    }
  }
});

test('shiftAxial translates along the local x-axis unit direction at the exact rate', () => {
  const { svg: out, report } = applyGeometry(axialSvg(ROT), [
    { ids: ['s'], param: 'dim', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.4 } },
  ], { dim: '350' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // d = (350-100)*0.4 = 100 user units along (a,b)/|(a,b)| = (0.6,0.8):
  //   e' = 10 + 0.6*100 = 70,  f' = 20 + 0.8*100 = 100. Scale column untouched.
  assert.deepEqual(parseMatrix(out.match(/transform="([^"]*)"/)[1]), { a: 6, b: 8, c: 0, d: 5, e: 70, f: 100 });
});

test('shiftAxial with b=0 is byte-identical to shiftX', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="x" transform="matrix(2,0,0,3,10,20)" d="M 0,0 H 5"/></svg>';
  const run = (op) => applyGeometry(svg, [{ ids: ['x'], param: 'dim', geom: { op, anchor: 100, pxPerUnit: 0.5 } }], { dim: '350' });
  const cli = run('shiftX');
  const ax = run('shiftAxial');
  assert.equal(ax.svg, cli.svg);
  assert.deepEqual(ax.report.map((r) => r.ok), cli.report.map((r) => r.ok));
});

test('axial ops report unusable extents and degenerate axes, never thrown', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<path id="nod"/>'
    + '<path id="zero" transform="matrix(0,0,0,1,5,6)" d="M 0,0 H 5"/>'
    + '<path id="ok" transform="matrix(1,0,0,1,0,0)" d="M 0,0 H 5"/></svg>';
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['nod'], param: 'd', geom: { op: 'stretchAxial', about: 'max', anchor: 100 } },
    { ids: ['zero'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.5 } },
    { ids: ['ok'], param: 'd', geom: { op: 'stretchAxial', about: 'min', anchor: 100 } },
    { ids: ['ok'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.5 } },
    { ids: ['ok'], param: 'd', geom: { op: 'shear', anchor: 100 } },
  ], { d: '150' });
  assert.equal(report[0].ok, false);
  assert.match(report[0].reason, /no local extent/, 'stretchAxial about "max" needs a d extent');
  assert.equal(report[1].ok, false);
  assert.match(report[1].reason, /degenerate/, 'shiftAxial refuses a zero-length axis');
  assert.equal(report[2].ok, true, 'stretchAxial about "min" needs no extent (p0=0)');
  assert.equal(report[3].ok, true, 'identity axis (1,0) is a valid direction');
  assert.equal(report[4].ok, false);
  assert.match(report[4].reason, /unknown op/);
  // failed rows leave their elements untouched
  assert.match(out, /<path id="nod"\/>/);
  assert.match(out, /matrix\(0,0,0,1,5,6\)/);
});

// ---------- #23: the d-level axial op — axis-aligned matrix, diagonal path data ----------

// The #20 finding: on converted art the rotation lives in path DATA (the
// matrix is an axis-aligned scale/flip), so the element's local axis is the
// unit vector of the dominant straight run in d, recovered by localAxis()
// and shared by the engine and the proposal stage.

test('localAxis recovers the dominant straight run of a bent path (abs+rel), projection extent included', () => {
  const ax = localAxis(null, 'M 0,0 L 30,40 l 0,100');
  // runs: (0,0)->(30,40) len 50 and (30,40)->(30,140) len 100 -> dominant is vertical
  assert.deepEqual(ax.l, [0, 1]);
  assert.equal(ax.lo, 0);
  assert.equal(ax.hi, 140);
  assert.deepEqual(ax.pLo, [0, 0], 'projection-min anchor');
  assert.deepEqual(ax.pHi, [30, 140], 'projection-max anchor');
});

test('localAxis maps the axis through the matrix into user space (flip honoured)', () => {
  const ax = localAxis({ a: 2, b: 0, c: 0, d: -2, e: 10, f: 20 }, 'M 0,0 L 30,40');
  // local (0.6,0.8) -> user (1.2,-1.6) -> unit (0.6,-0.8)
  assert.ok(Math.abs(ax.u[0] - 0.6) < 1e-9 && Math.abs(ax.u[1] + 0.8) < 1e-9, JSON.stringify(ax.u));
  assert.equal(ax.lo, 0);
  assert.equal(ax.hi, 50);
});

test('localAxis: curves-only and degenerate paths have no axis; arcs are flagged', () => {
  assert.equal(localAxis(null, 'M 0,0 C 1,2 3,4 5,6'), null, 'no straight segment');
  assert.equal(localAxis(null, 'M 0,0 L 0,0'), null, 'degenerate zero-length runs');
  assert.equal(localAxis(null, 'M 0,0 z'), null, 'a lone close is no run');
  const arc = localAxis(null, 'M 0,0 L 10,0 A 5,5 0 0 1 20,0');
  assert.ok(arc && arc.arc, 'arc flag set; the straight run is still recovered');
  assert.deepEqual(arc.l, [1, 0]);
});

test('stretchAxial (d level) about:"min" pins the projection-min end; the far end rides the axis', () => {
  const { svg: out, report } = applyGeometry(axialSvg('<path id="s" transform="matrix(2,0,0,2,10,20)" d="M 0,0 L 30,40"/>'), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', anchor: 200 } },   // omitted about = "min"
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // ratio 1.5, u=(0.6,0.8): the linear map p' = p + 0.5·(p·u)·u sends
  // (30,40) (p·u=50) to (45,60); p0 = lo = 0 -> no translation fix, and the
  // matrix column is NOT scaled (the axis is not the matrix's x column).
  const m = parseMatrix(out.match(/transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 });
  assert.match(out, /d="M 0,0 L 45,60"/);
  // rendered: the far end user position before (70,100) -> (100,140): 1.5x
  // further along the SAME user direction (60,80)/100 — angle preserved.
});

test('stretchAxial (d level) about:"max" pins the far end in user space via the translation fix', () => {
  const { svg: out, report } = applyGeometry(axialSvg('<path id="s" transform="matrix(2,0,0,2,10,20)" d="M 0,0 L 30,40"/>'), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'max', anchor: 200 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // p0 = hi = 50; fix = (1-1.5)·50·M·u = -25·(1.2,1.6) = (-30,-40) -> (e,f) = (-20,-20)
  const m = parseMatrix(out.match(/transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 2, b: 0, c: 0, d: 2, e: -20, f: -20 });
  assert.match(out, /d="M 0,0 L 45,60"/);
  // the pinned end: before (2·30+10, 2·40+20) = (70,100); after (2·45-20, 2·60-20) = (70,100)
});

test('stretchAxial (d level) deforms a two-segment bend exactly', () => {
  const { svg: out, report } = applyGeometry(axialSvg('<path id="s" transform="matrix(1,0,0,1,10,20)" d="M 0,0 L 30,40 L 30,140"/>'), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'max', anchor: 100 } },
  ], { dim: '200' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // dominant run: the 100-long vertical leg -> u=(0,1); the linear map is
  // P(x,y)=(x,2y): both legs deform exactly.
  const m = parseMatrix(out.match(/transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 10, f: -120 });
  assert.match(out, /d="M 0,0 L 30,80 L 30,280"/);
  // pinned user end: (30,140)+(10,20) = (40,160) before and after.
});

test('stretchAxial (d level) maps curve control points, so curves deform exactly', () => {
  const { svg: out, report } = applyGeometry(axialSvg('<path id="s" transform="matrix(1,0,0,1,10,20)" d="M 0,0 V 40 C 10,50 -10,60 0,70"/>'), [
    { ids: ['s'], param: 'dim', geom: { op: 'stretchAxial', about: 'max', anchor: 100 } },
  ], { dim: '200' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  // u=(0,1) from the V leg; P(x,y)=(x,2y); the V collapses to L (the map
  // mixes x and y in general); p0 = hi = 70 -> fix (0,-70).
  const m = parseMatrix(out.match(/transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 10, f: -50 });
  assert.match(out, /d="M 0,0 L 0,80 C 10,100 -10,120 0,140"/);
  // exactness, independently checked: the cubic B(0.5) = (P0+3c1+3c2+P1)/8
  // is (0,55) before and (0,110) after — exactly P, no flattening.
});

test('stretchAxial (d level) reports arcs and curve-only paths, never thrown', () => {
  const svg = axialSvg(
    '<path id="arc" transform="matrix(1,0,0,1,0,0)" d="M 0,0 L 30,40 A 5,5 0 0 1 50,60"/>'
    + '<path id="curvy" transform="matrix(1,0,0,1,0,0)" d="M 0,0 C 1,2 3,4 5,6"/>'
    + '<path id="straight" transform="matrix(1,0,0,1,0,0)" d="M 0,0 L 30,40"/>',
  );
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['arc'], param: 'd', geom: { op: 'stretchAxial', anchor: 100 } },
    { ids: ['curvy'], param: 'd', geom: { op: 'stretchAxial', anchor: 100 } },
    { ids: ['straight'], param: 'd', geom: { op: 'stretchAxial', anchor: 100 } },
  ], { d: '150' });
  assert.equal(report[0].ok, false);
  assert.match(report[0].reason, /arc/, 'a non-uniform map cannot deform an arc exactly');
  assert.equal(report[1].ok, false);
  assert.match(report[1].reason, /no local extent/, 'no straight segment -> no axis -> no op');
  assert.equal(report[2].ok, true, 'a diagonal straight d is the d-level case');
  assert.match(out, /d="M 0,0 L 30,40 A 5,5 0 0 1 50,60"/, 'failed rows leave d untouched');
});

test('shiftAxial (d level) translates along the data axis in user space, matrix flip included', () => {
  const svg = axialSvg('<path id="s" transform="matrix(1.3333333,0,0,-1.3333333,50,60)" d="M 0,0 L -120.043,197.853"/>');
  const { svg: out, report } = applyGeometry(svg, [
    { ids: ['s'], param: 'dim', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.5 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, true, JSON.stringify(report[0]));
  const m = parseMatrix(out.match(/transform="([^"]*)"/)[1]);
  const len = Math.hypot(-120.043, 197.853);
  const ux = -120.043 / len, uy = 197.853 / len;
  // direction = M·u normalized: the d=-1.3333 flip flips the y component —
  // this is NOT the matrix's (a,b) column (1.3333,0).
  assert.ok(Math.abs(m.e - (50 + ux * 100)) < 1e-4 && Math.abs(m.f - (60 - uy * 100)) < 1e-4, JSON.stringify(m));
});

test('shiftAxial (d level) reports a path with no straight segment', () => {
  const { report } = applyGeometry(axialSvg('<path id="s" transform="matrix(1,0,0,1,0,0)" d="M 0,0 C 1,2 3,4 5,6"/>'), [
    { ids: ['s'], param: 'dim', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.5 } },
  ], { dim: '300' });
  assert.equal(report[0].ok, false);
  assert.match(report[0].reason, /no straight segment/);
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

test('part proposal: a tilted candidate (<=12.5° band) classifies into the X family — no longer ambiguous', () => {
  // 10° tilt: previously non-axis-aligned -> the whole dim was ambiguous;
  // the orientation bands (#22) put it in the X family and today's rules
  // simply skip it (it spans/attaches nothing on the measured axis).
  const rows = [...partRows, { id: 'tilted', x: 200, y: 300, w: 98.5, h: 18 }];
  const svg = partSvg + '<path id="tilted" transform="matrix(0.9848,0.1736,0,1,200,300)" d="M 0,0 H 100"/>';
  const { bindings, parts } = proposeGeometry(rows, partProps, svg);
  assert.ok(bindings.some((b) => b.ids.includes('barL')) && bindings.some((b) => b.ids.includes('barR')), 'the span bars still bind');
  assert.ok(!bindings.some((b) => b.ids.includes('tilted')), 'the tilted element is not a part');
  assert.deepEqual(parts, [{ param: 'dim1', bound: 2, skipped: 1 }], 'classified and skipped — the dim is not ambiguous');
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

// ---------- part bindings (#22): rotated candidates classify; axial span/attach ----------

// A VERTICAL dim (the 003 dim4 shape: platform height). Line extent 250 px =
// 2500 mm (s = 0.1 px/mm); datum plane y=200 (the matrix translation end),
// moving plane y=450. A ~60° stringer pair spans it; a 53° tread rides the
// moving plane.
const SQ3 = Math.sqrt(3) / 2;                 // sin(60°)
const STR_LEN = 250 / SQ3;                    // user length with a 250 px rise
const axialPartSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="vline" transform="matrix(1,0,0,1,100,200)" d="M 0,0 V 250"/>'
  + '<path id="va1" d="M 0,0 l 2,-8 2,8 z" transform="matrix(1,0,0,1,98.25,196)"/>'
  + '<path id="va2" d="M 0,0 l 2,8 2,-8 z" transform="matrix(1,0,0,1,98.25,448)"/>'
  // local origin at the MOVING (bottom) end; far local end lands on the datum plane
  + `<path id="strA" transform="matrix(0.5,${-SQ3},0,1,250,450)" d="M 0,0 H ${STR_LEN}"/>`
  // local origin at the DATUM (top) end
  + `<path id="strB" transform="matrix(0.5,${SQ3},0,1,250,200)" d="M 0,0 H ${STR_LEN}"/>`
  + '</svg>';
const axialPartRows = [
  { id: 'vline', x: 100, y: 200, w: 0.5, h: 250 },
  { id: 'va1', x: 98.25, y: 196, w: 4, h: 4 },
  { id: 'va2', x: 98.25, y: 448, w: 4, h: 4 },
  { id: 'strA', x: 250, y: 200, w: 0.5 * STR_LEN, h: 250 },
  { id: 'strB', x: 250, y: 200, w: 0.5 * STR_LEN, h: 250 },
];
const axialPartProps = [{ id: 'dimV', value: '2500', geom: { vertical: true, glyphs: [{ id: 'tv1', x: 104, y: 300 }, { id: 'tv2', x: 104, y: 308 }] } }];

test('part proposal: a diagonal spanning the dim extent binds stretchAxial, about on the datum side (both local orientations)', () => {
  const { bindings, parts } = proposeGeometry(axialPartRows, axialPartProps, axialPartSvg);
  const strA = bindings.find((b) => b.ids[0] === 'strA');
  const strB = bindings.find((b) => b.ids[0] === 'strB');
  assert.deepEqual(strA.geom, { op: 'stretchAxial', about: 'max', anchor: 2500 },
    'origin end sits at the moving plane -> the far (datum-side) local end stays put');
  assert.deepEqual(strB.geom, { op: 'stretchAxial', about: 'min', anchor: 2500 },
    'origin end sits at the datum plane -> the local-origin end stays put');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 2, skipped: 0 }]);
});

test('part proposal: stretchAxial render pins the datum-side end of a rotated span', () => {
  const { bindings } = proposeGeometry(axialPartRows, axialPartProps, axialPartSvg);
  const b = bindings.find((x) => x.ids[0] === 'strA');
  const { svg: out } = applyGeometry(axialPartSvg, [b], { dimV: '3000' });
  const re = /<path\b[^>]*\bid="strA"[^>]*transform="([^"]*)"/;
  const before = parseMatrix(axialPartSvg.match(re)[1]);
  const after = parseMatrix(out.match(re)[1]);
  const ratio = 3000 / 2500;
  // the pinned end is the local-max end (about "max"): its user position
  // (a*STR_LEN + e, b*STR_LEN + f) must stay exactly on the datum plane.
  const pin = (m) => [m.a * STR_LEN + m.e, m.b * STR_LEN + m.f];
  const p0 = pin(before), p1 = pin(after);
  // (1e-3: the engine re-serialises matrices at 5 decimals)
  assert.ok(Math.abs(p1[0] - p0[0]) < 1e-3 && Math.abs(p1[1] - p0[1]) < 1e-3, `pinned end ${p0} -> ${p1}`);
  assert.ok(Math.abs(p1[1] - 200) < 1e-3, 'the pinned end sits on the datum plane (y=200)');
  assert.ok(Math.abs(after.a - before.a * ratio) < 1e-4 && Math.abs(after.b - before.b * ratio) < 1e-4, 'the whole (a,b) column scales by the ratio');
});

test('part proposal: a diagonal attached to the moving plane binds shiftAxial at s/sin(alpha), to the digit', () => {
  // 3-4-5 axis: (a,b) = (0.6,0.8), |(a,b)| = 1 exactly; sin(alpha) = |b|/|(a,b)|
  // = 0.8 against the vertical measured axis -> s_along = 0.1/0.8 = 0.125.
  const rows = [...axialPartRows, { id: 'tread', x: 330, y: 445, w: 12, h: 16 }];
  const svg = axialPartSvg + '<path id="tread" transform="matrix(0.6,0.8,0,1,330,445)" d="M 0,0 H 20"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  const tread = bindings.find((b) => b.ids[0] === 'tread');
  assert.deepEqual(tread.geom, { op: 'shiftAxial', anchor: 2500, pxPerUnit: 0.125 },
    'rate = s / sin(alpha): the plane moves 0.1 px/mm vertically, the axis lands 0.8 of its travel on y');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 3, skipped: 0 }], '2 stringers + 1 tread');
  // rendered: dim 2500 -> 3000 moves the tread rigidly along its own axis by
  // 500 * 0.125 = 62.5 user units * (0.6, 0.8) = (37.5, 50)
  const { svg: out } = applyGeometry(svg, [tread], { dimV: '3000' });
  const m = parseMatrix(out.match(/<path\b[^>]*\bid="tread"[^>]*transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 0.6, b: 0.8, c: 0, d: 1, e: 367.5, f: 495 });
  // and its near projected point (bbox y-min) rides the moved plane: 445+50 = 495 = 450 + 500*0.1
});

test('part proposal: a diagonal whose projection overlaps both end planes, without matching a rule, still forfeits the dim', () => {
  // projection y=180..470: longer than the extent (no span), near point far
  // from the moving plane (no attach), yet it overlaps both end planes.
  const L = 290 / SQ3;
  const rows = [...axialPartRows, { id: 'wild', x: 250, y: 180, w: 0.5 * L, h: 290 }];
  const svg = axialPartSvg + `<path id="wild" transform="matrix(0.5,${SQ3},0,1,250,180)" d="M 0,0 H ${L}"/>`;
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('strA') || b.ids.includes('strB') || b.ids.includes('wild')), 'nothing binds for the dim');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 0, skipped: 1, ambiguous: true }]);
  assert.ok(bindings.some((b) => b.ids.includes('vline') && b.geom.op === 'stretchY'), 'the annotation proposal is unaffected');
});

test('part proposal: rotated annotation text in the box classifies, is skipped, never a part, never ambiguous', () => {
  const rows = [...axialPartRows, { id: 'rotNote', x: 150, y: 300, w: 12, h: 16 }];
  const svg = axialPartSvg + '<text id="rotNote" transform="matrix(0.6,0.8,0,1,150,300)">2500</text>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('rotNote')), 'rotated text never binds');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 2, skipped: 1 }], 'the stringers still bind; the text is a plain skip');
});

test('part proposal: a rotated candidate without a usable path extent is skipped, reported, never ambiguous', () => {
  const rows = [...axialPartRows, { id: 'rotRect', x: 150, y: 300, w: 12, h: 16 }];
  const svg = axialPartSvg + '<rect id="rotRect" transform="matrix(0.6,0.8,0,1,150,300)" width="12" height="16"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('rotRect')), 'no d extent -> no axial op');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 2, skipped: 1 }]);
});

// ---------- part bindings (#23): data-diagonal candidates (003-shaped art) ----------

// Same vertical dim as the #22 fixture (line extent 250 px = 2500 mm, datum
// plane y=200, moving plane y=450), but the stringers carry their angle in
// path DATA — axis-aligned identity matrices, diagonal d. The classification
// recovers the axis from d (the #20 finding: converted art bakes rotation
// into path data), and the projected-bbox checks run on the d-level geometry
// (anchor endpoints through the matrix), not the matrix angle.
const RUN60 = 250 / Math.sqrt(3);              // horizontal run of a 60° stringer (rise 250)
const dataAxialSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="vline" transform="matrix(1,0,0,1,100,200)" d="M 0,0 V 250"/>'
  + '<path id="va1" d="M 0,0 l 2,-8 2,8 z" transform="matrix(1,0,0,1,98.25,196)"/>'
  + '<path id="va2" d="M 0,0 l 2,8 2,-8 z" transform="matrix(1,0,0,1,98.25,448)"/>'
  // local origin at the MOVING (bottom, y=450) end; the far local end lands
  // on the datum plane (user y=200) — the matrix carries no rotation
  + `<path id="strC" transform="matrix(1,0,0,1,250,450)" d="M 0,0 L ${RUN60},-250"/>`
  // local origin at the DATUM (top, y=200) end
  + `<path id="strD" transform="matrix(1,0,0,1,250,200)" d="M 0,0 L ${RUN60},250"/>`
  + '</svg>';
const dataAxialRows = [
  { id: 'vline', x: 100, y: 200, w: 0.5, h: 250 },
  { id: 'va1', x: 98.25, y: 196, w: 4, h: 4 },
  { id: 'va2', x: 98.25, y: 448, w: 4, h: 4 },
  { id: 'strC', x: 250, y: 200, w: RUN60, h: 250 },
  { id: 'strD', x: 250, y: 200, w: RUN60, h: 250 },
];

test('part proposal: a data-diagonal spanning the dim binds stretchAxial, about on the datum side (both local orientations)', () => {
  const { bindings, parts } = proposeGeometry(dataAxialRows, axialPartProps, dataAxialSvg);
  const strC = bindings.find((b) => b.ids[0] === 'strC');
  const strD = bindings.find((b) => b.ids[0] === 'strD');
  assert.deepEqual(strC.geom, { op: 'stretchAxial', about: 'max', anchor: 2500 },
    'local origin at the moving plane -> the far (datum-side) projection end stays put');
  assert.deepEqual(strD.geom, { op: 'stretchAxial', about: 'min', anchor: 2500 },
    'local origin at the datum plane -> the projection-min end stays put');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 2, skipped: 0 }]);
});

test('part proposal: the data-diagonal span renders — the datum-side end stays pinned in user space', () => {
  const { bindings } = proposeGeometry(dataAxialRows, axialPartProps, dataAxialSvg);
  const b = bindings.find((x) => x.ids[0] === 'strC');
  const { svg: out } = applyGeometry(dataAxialSvg, [b], { dimV: '3000' });
  const re = /<path\b[^>]*\bid="strC"[^>]*>/;
  const before = parseMatrix(dataAxialSvg.match(re)[0].match(/transform="([^"]*)"/)[1]);
  const afterTag = out.match(re)[0];
  const after = parseMatrix(afterTag.match(/transform="([^"]*)"/)[1]);
  // the pinned end is the local far end (about "max"): user position from the
  // rewritten d (P linear, fix applied) must stay on the datum plane (y=200).
  const dAfter = afterTag.match(/\bd="([^"]*)"/)[1];
  const ax = localAxis(after, dAfter);
  assert.ok(ax, dAfter);
  const pinLocal = [ax.pHi[0], ax.pHi[1]];   // pHi in the rewritten d
  const pinUser = [after.a * pinLocal[0] + after.e, after.d * pinLocal[1] + after.f];
  const pinBefore = [before.a * RUN60 + before.e, before.d * -250 + before.f];
  assert.ok(Math.abs(pinUser[0] - pinBefore[0]) < 1e-3 && Math.abs(pinUser[1] - pinBefore[1]) < 1e-3,
    `pinned end ${pinBefore} -> ${pinUser}`);
  assert.ok(Math.abs(pinUser[1] - 200) < 1e-3, 'the pinned end sits on the datum plane (y=200)');
});

test('part proposal: a data-diagonal attached to the moving plane binds shiftAxial at s/comp, to the digit', () => {
  // 3-4-5 data axis (local (0.6,0.8)); identity matrix; the near projected
  // point sits on the moving plane y=450. Length 40: a tread-sized member
  // (the proposal's noise gate keeps sub-tolerance fragments axis-aligned).
  const rows = [...dataAxialRows, { id: 'tread', x: 330, y: 450, w: 24, h: 32 }];
  const svg = dataAxialSvg + '<path id="tread" transform="matrix(1,0,0,1,330,450)" d="M 0,0 L 24,32"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  const tread = bindings.find((b) => b.ids[0] === 'tread');
  assert.deepEqual(tread.geom, { op: 'shiftAxial', anchor: 2500, pxPerUnit: 0.125 },
    'rate = s / (axis component on the measured axis): 0.1 / 0.8');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 3, skipped: 0 }], '2 stringers + 1 tread');
  // rendered: dim 2500 -> 3000 moves the tread rigidly along its data axis by
  // 500 * 0.125 = 62.5 user units * (0.6, 0.8) = (37.5, 50)
  const { svg: out } = applyGeometry(svg, [tread], { dimV: '3000' });
  const m = parseMatrix(out.match(/<path\b[^>]*\bid="tread"[^>]*transform="([^"]*)"/)[1]);
  assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 367.5, f: 500 });
});

test('part proposal: a data-diagonal whose projection overlaps both end planes, without matching a rule, still forfeits the dim', () => {
  const LR = 290 / Math.sqrt(3);
  const rows = [...dataAxialRows, { id: 'wild', x: 250, y: 180, w: LR, h: 290 }];
  const svg = dataAxialSvg + `<path id="wild" transform="matrix(1,0,0,1,250,470)" d="M 0,0 L ${LR},-290"/>`;
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  assert.ok(!bindings.some((b) => b.ids.includes('strC') || b.ids.includes('strD') || b.ids.includes('wild')), 'nothing binds for the dim');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 0, skipped: 1, ambiguous: true }]);
  assert.ok(bindings.some((b) => b.ids.includes('vline') && b.geom.op === 'stretchY'), 'the annotation proposal is unaffected');
});

test('part proposal: a data tilt within the band keeps the X/Y family — a diagonal arc path is skipped, not ambiguous', () => {
  // 10° data tilt: within ±12.5° of horizontal -> X family, same as a tilted
  // matrix (#22) but recovered from d.
  const rows = [...dataAxialRows, { id: 'tiltData', x: 200, y: 300, w: 98.5, h: 18 }];
  const svg = dataAxialSvg + '<path id="tiltData" transform="matrix(1,0,0,1,200,300)" d="M 0,0 L 98.5,17.36"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  assert.ok(bindings.some((b) => b.ids.includes('strC')) && bindings.some((b) => b.ids.includes('strD')), 'the stringers still bind');
  assert.ok(!bindings.some((b) => b.ids.includes('tiltData')), 'the band-tilted element is not axial');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 2, skipped: 1 }]);
  // an AXIAL data path with an arc cannot be stretched exactly -> skipped,
  // reported, never a part, never ambiguous (same rule as #22's no-extent
  // case). Length 50 keeps it above the proposal's fragment gate so it
  // reaches the axial rules at all.
  const rows2 = [...dataAxialRows, { id: 'arcData', x: 300, y: 300, w: 50, h: 50 }];
  const svg2 = dataAxialSvg + '<path id="arcData" transform="matrix(1,0,0,1,300,300)" d="M 0,0 L 30,40 A 10,10 0 0 1 50,30"/>';
  const g2 = proposeGeometry(rows2, axialPartProps, svg2);
  assert.ok(!g2.bindings.some((b) => b.ids.includes('arcData')), 'the arc path never binds');
  assert.deepEqual(g2.parts, [{ param: 'dimV', bound: 2, skipped: 1 }]);
});

test('part proposal: a blob whose straight runs compete is not an axial member (dominance gate)', () => {
  // The #11 rail-bolt shape: 'M 0,0 h 6 v 6 z'. Its hypotenuse (8.49) is the
  // longest single run, but only 1.4x the legs — the element is a plate
  // outline, not an axial member, and must keep the axis-aligned attach
  // rule (shiftX rides the plane purely; shiftAxial would drift it off the
  // plane laterally).
  const rows = [...dataAxialRows, { id: 'bolt', x: 330, y: 446, w: 6, h: 6 }];
  const svg = dataAxialSvg + '<path id="bolt" transform="matrix(1,0,0,1,330,446)" d="M 0,0 h 6 v 6 z"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  const bolt = bindings.find((b) => b.ids[0] === 'bolt');
  assert.deepEqual(bolt?.geom, { op: 'shiftY', anchor: 2500, pxPerUnit: 0.1 },
    'the bolt keeps the axis-aligned attach rule');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 3, skipped: 0 }], '2 stringers + the bolt');
});

test('part proposal: a sub-tolerance diagonal fragment keeps the axis-aligned attach (noise gate)', () => {
  // The 003 dim1 arrowhead-fragment shape ('M 0,0 1.642,-1.562', ~2 px):
  // shorter than the span tolerance band it is a fragment, not an axial
  // member — the axial op would ride the plane but drift it laterally.
  // Gate: |M·l|·bestLen = 20 < tol = 25.
  const rows = [...dataAxialRows, { id: 'tick', x: 330, y: 446, w: 3, h: 3 }];
  const svg = dataAxialSvg + '<path id="tick" transform="matrix(1,0,0,1,330,450)" d="M 0,0 L 1.642,-1.562"/>';
  const { bindings, parts } = proposeGeometry(rows, axialPartProps, svg);
  const tick = bindings.find((b) => b.ids[0] === 'tick');
  assert.deepEqual(tick?.geom, { op: 'shiftY', anchor: 2500, pxPerUnit: 0.1 },
    'the fragment rides the plane at the full rate, axis-aligned');
  assert.deepEqual(parts, [{ param: 'dimV', bound: 3, skipped: 0 }], '2 stringers + the fragment');
});

// ---------- #22 real art: 003 dim4 (platform height) and the axial rules ----------

// INVESTIGATION FINDING (locked here so a converter change can't silently
// reopen it): the Inkscape PDF import gives every PATH a scale/flip matrix
// `matrix(1.3333,0,0,-1.3333,e,f)` — the staircase stringers' rotation is
// baked into their path data ("M 0,0 -120.043,197.853"), not into the
// matrix. The only elements with rotated matrices are the vertical dim
// TEXTS. Spec #20's #22 classification measured θ = atan2(b,a) FROM THE
// MATRIX, so every path candidate on this art landed in the X/Y family and
// no axial rule could ever engage. Ticket #23 added the path-data level:
// the axis is recovered from the dominant straight run of d (localAxis),
// the engine applies the linear map at the d level, and the classifier
// calls a data diagonal AXIAL — see the #23 real-art test below for the
// stringer's rule match and the rendered proof. This #22 test locks what
// has NOT changed: the dim is still forfeited all-or-nothing by the
// full-height sheet-frame lines, so the scaffolded template still carries
// no axial binding.
test('#22 real art: 003 dim4 = 2500; the staircase diagonals live in path data, so the proposal stays axis-aligned and the dim stays ambiguous', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-axial-'));
  const r = await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm: false, id: 'geo-003-axial', templatesDir: tmp });
  // The spec evidence pack says dim4 = 2500 is the platform height — the
  // scaffold confirms the positional dim ids on this PDF.
  assert.equal(r.props.find((p) => p.id === 'dim4')?.value, '2500');

  const dir = join(tmp, 'geo-003-axial');
  const clean = readFileSync(join(dir, 'base.clean.svg'), 'utf8');
  const rows = parseQueryAll(execFileSync('inkscape', ['--query-all', join(dir, 'base.clean.svg')], { encoding: 'utf8', maxBuffer: 1 << 28 }));

  // The two stringers are path1491/path1492 (diagonal path data, measured
  // from base.clean.svg): their matrices are axis-aligned, their d is not.
  for (const id of ['path1491', 'path1492']) {
    const tag = clean.match(new RegExp(`<path\\b[^>]*?\\bid="${id}"[^>]*>`))[0];
    const m = parseMatrix(tag.match(/transform="([^"]*)"/)[1]);
    assert.equal(m.b, 0, `${id}: the stringer's matrix carries no rotation (b=0) — #23 recovers the axis from d`);
    assert.match(tag, /d="M 0,0 -/u, `${id}: the diagonal lives in the path data`);
    assert.ok(rows.some((x) => x.id === id && x.w > 0 && x.h > 0));
  }
  // ... and so is every other non-text element in the drawing: nothing with
  // a rotated matrix exists for the classifier to call AXIAL.
  const rotatedPaths = rows.filter((row) => {
    const m = clean.match(new RegExp(`<[a-zA-Z][^>]*?\\bid="${row.id}"[^>]*?\\btransform="matrix\\(([-\\d.eE]+),([-\\d.eE]+),`));
    return m && Math.abs(+m[2]) > 1e-9 && !/^<text\b/u.test(m[0]);
  }).map((row) => row.id);
  assert.deepEqual(rotatedPaths, [], 'no non-text element in the whole drawing has a rotated matrix');

  // Consequences, locked: the full-height sheet-frame lines path7315/
  // path7320 (x=43.8/26.4, full height 732/767 px, 1 px wide) overlap BOTH
  // end planes, but at 2.1-3x the dim extent they are sheet furniture, not
  // members — the FRAME_FACTOR gate (#20) skips them instead of poisoning
  // the dim. Un-poisoning dim4 un-locks its WHOLE rule-matched proposal:
  // 186 bindings — the platform-height dim carries the entire moving-side
  // assembly (shiftY), including the far stringer's stretchAxial and
  // path1490's shiftAxial (the two diagonal members). The path1491 gap is
  // measured in the #23 proof below. All-or-nothing still holds for
  // member-sized overlaps.
  const d4 = r.parts.find((d) => d.param === 'dim4');
  // counts are toolchain-drift-sensitive (converter version changes the
  // art) — lock the invariants, not the numbers
  assert.ok(d4.bound >= 1 && d4.skipped > 0, `dim4 bound ${d4.bound}, skipped ${d4.skipped}`);
  assert.ok(!d4.ambiguous, 'the frame gate un-poisoned dim4');
  for (const id of ['path7315', 'path7320']) {
    const row = rows.find((x) => x.id === id);
    assert.ok(row && row.h > 700, `${id} is a full-height frame line (skipped, not ambiguous)`);
  }

  // and the shape of the whole proposal: TWO axial ops survive — the far
  // stringer (span) and path1490 (a diagonal attach, shiftAxial). The
  // sub-tolerance diagonal fragments (arrowhead halves like path1691/1692)
  // stay axis-aligned via the noise gate.
  const tpl = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8'));
  const axial = tpl.bindings.filter((b) => b.geom?.op?.endsWith('Axial'));
  const stringer = axial.find((b) => (b.ids || []).includes('path1492'));
  assert.deepEqual({ op: stringer?.geom.op, about: stringer?.geom.about ?? null },
    { op: 'stretchAxial', about: 'max' }, 'the far stringer binds stretchAxial about max');
  assert.ok(axial.every((b) => /^path/u.test(b.ids[0])), 'axial bindings are paths, never texts');
});

// ---------- #23 real art: the 003 stringer follows dim4 (rule match + rendered proof) ----------

// path1492 — the far staircase stringer — rule-matches the axial span
// (data-diagonal classification, d-level projection 216.9..480.7 against
// the dim4 planes 218.9..477.6, tol ±25.9). path1491 — the near stringer —
// stops 29 px short of the moving plane (3 px over tolerance; the same
// tread/stringer gap #22 documented), so only ONE stringer rule-matches.
// No tread-row element cleanly attaches with shiftAxial on this art: the
// diagonal candidates near the moving plane are sub-tolerance hatch and
// arrowhead fragments (the proposal's noise gate keeps them axis-aligned)
// and the larger diagonal pieces are stringer duplicates, not riders.
// The sheet-frame lines path7315/path7320 no longer forfeit the dim: at
// 2.1-3x the dim extent the FRAME_FACTOR gate skips them as sheet
// furniture. The scaffolded template therefore carries the stringer
// binding directly — no hand-accept — and the rendered proof below shows
// the staircase following dim4 = 3000 exactly.
test('#23 real art: 003 dim4 = 3000 — the stringer follows (rendered proof)', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-axial23-'));
  const r = await scaffold(join(repo, 'LSB-2607-003-RHC-R00.pdf'), { llm: false, id: 'geo-003-axial23', templatesDir: tmp });
  assert.equal(r.props.find((p) => p.id === 'dim4')?.value, '2500');
  const dir = join(tmp, 'geo-003-axial23');
  const clean = readFileSync(join(dir, 'base.clean.svg'), 'utf8');
  const rows = parseQueryAll(execFileSync('inkscape', ['--query-all', join(dir, 'base.clean.svg')], { encoding: 'utf8', maxBuffer: 1 << 28 }));

  // The dim's own geometry (the same rec the proposal stage used).
  const g = proposeGeometry(rows, r.props, clean);
  const rec4 = g.recs.find((x) => x.p.id === 'dim4');
  assert.ok(rec4, 'dim4 line recognised');
  const extent = rec4.extent;
  const s = extent / 2500;                       // 0.10348 px/mm, self-calibrated
  const d0 = rec4.line.y, d1 = d0 + rec4.line.h; // 218.9 .. 477.6
  const datumC = rec4.datum.y;                   // 218.9 (top / platform side)
  const tol = SPAN_TOL * extent;                 // ±25.9

  // Re-derive the span rule for each stringer on the d-level geometry
  // (anchor endpoints through the matrix — the #23 contract), independent
  // of the proposal loop:
  const tagOf = (id) => clean.match(new RegExp(`<[a-zA-Z][^>]*?\\bid="${id}"[^>]*>`))[0];
  const projOf = (id) => {
    const tag = tagOf(id);
    const m = parseMatrix(tag.match(/transform="([^"]*)"/)[1]);
    const ax = localAxis(m, tag.match(/\bd="([^"]*)"/)[1]);
    assert.ok(ax && ax.u, `${id}: data-diagonal axis recovered`);
    const ps = ax.pts.map((p) => m.b * p[0] + m.d * p[1] + m.f);
    return { ax, m, r0: Math.min(...ps), r1: Math.max(...ps), qLo: ax.pLo[0] * m.b + ax.pLo[1] * m.d + m.f, qHi: ax.pHi[0] * m.b + ax.pHi[1] * m.d + m.f };
  };
  // path1492: the far stringer. Axis (−0.519,−0.855) in user space (the
  // d=−1.3333 flip turns the local uphill (+y) into page-up), a dominant
  // 231-local-unit run — an axial member by both gates.
  const far = projOf('path1492');
  assert.ok(Math.abs(far.ax.u[0] + 0.519) < 1e-3 && Math.abs(far.ax.u[1] + 0.855) < 1e-3, `path1492 user axis ${far.ax.u}`);
  assert.ok(Math.abs(far.r1 - far.r0 - extent) <= tol && Math.abs(far.r0 - d0) <= tol && Math.abs(far.r1 - d1) <= tol,
    `path1492 spans the dim (proj ${far.r0.toFixed(1)}..${far.r1.toFixed(1)} vs planes ${d0.toFixed(1)}..${d1.toFixed(1)}, tol ${tol.toFixed(1)})`);
  // the datum side is the projection-max end (user y 216.9, the platform
  // end) -> about "max" pins it; the ground end follows the moving plane.
  const about = Math.abs(far.qLo - datumC) <= Math.abs(far.qHi - datumC) ? 'min' : 'max';
  assert.equal(about, 'max');
  // path1491: the near stringer — the documented 3px miss, locked.
  const near = projOf('path1491');
  assert.ok(!(Math.abs(near.r1 - near.r0 - extent) <= tol && Math.abs(near.r0 - d0) <= tol && Math.abs(near.r1 - d1) <= tol),
    `path1491 stops ${(d1 - near.r1).toFixed(1)} px short of the moving plane — over tolerance, correctly unbound`);

  // Locked: the scaffold itself now emits the stringer binding (the frame
  // gate un-poisoned the dim) — dim4 carries its annotation cluster plus
  // exactly one part op.
  const d4p = r.parts.find((d) => d.param === 'dim4');
  assert.ok(d4p.bound >= 1 && !d4p.ambiguous, 'dim4 proposed parts (invariants, not counts)');
  const tpl = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8'));
  const d4Geom = tpl.bindings.filter((b) => b.param === 'dim4' && b.geom);
  assert.ok(d4Geom.length >= 4, 'dim4: annotation cluster + at least the stringer');
  const stringer = tpl.bindings.find((b) => (b.ids || []).includes('path1492'));
  assert.deepEqual(stringer.geom, { op: 'stretchAxial', about: 'max', anchor: 2500 }, 'the scaffold proposed the stringer binding');

  // The rendered proof: dim4 = 2500 -> 3000, straight from the scaffolded
  // template.
  const out = renderById(tmp, 'geo-003-axial23', { dim4: '3000' });
  assert.ifError(out.error);
  assert.ok(out.report.filter((b) => !b.ok).length === 0, JSON.stringify(out.report.filter((b) => !b.ok)));

  // Stringer outcome, measured on the RENDERED geometry (matrix + rewritten
  // d, projected onto the measured axis):
  const rendered = (svg) => {
    const tag = svg.match(/<path\b[^>]*\bid="path1492"[^>]*>/)[0];
    const m = parseMatrix(tag.match(/transform="([^"]*)"/)[1]);
    const ax = localAxis(m, tag.match(/\bd="([^"]*)"/)[1]);
    const ps = ax.pts.map((p) => m.b * p[0] + m.d * p[1] + m.f);
    return { ax, m, len: Math.max(...ps) - Math.min(...ps), pin: [m.a * ax.pHi[0] + m.c * ax.pHi[1] + m.e, m.b * ax.pHi[0] + m.d * ax.pHi[1] + m.f] };
  };
  const before = rendered(clean);
  const after = rendered(out.svg);
  // grew by (ratio-1) x its own projection along the SAME axis: the spec
  // number is 500*s px, admitted to ±SPAN_TOL of it (the span rule's own
  // tolerance — the stringer's projection differs from the dim extent by
  // less than that at the anchor, and the edit scales the difference).
  const growth = after.len - before.len;
  const expected = 500 * s;
  assert.ok(Math.abs(growth - expected) <= SPAN_TOL * expected,
    `stringer projected length grew ${growth.toFixed(2)} px, expected ${expected.toFixed(2)} ±${(SPAN_TOL * expected).toFixed(2)}`);
  // direction preserved: u is the map's eigen-direction — angle unchanged.
  const ang = (u) => Math.atan2(u[1], u[0]);
  assert.ok(Math.abs(ang(after.ax.u) - ang(before.ax.u)) < 1e-3, 'user axis angle preserved');
  // the pinned datum-side end did not move, and sits at the datum plane
  // within the span tolerance the rule admitted it with.
  assert.ok(Math.abs(after.pin[1] - before.pin[1]) < 1e-3 && Math.abs(after.pin[0] - before.pin[0]) < 1e-3,
    `pinned end ${before.pin.map((n) => n.toFixed(2))} -> ${after.pin.map((n) => n.toFixed(2))}`);
  assert.ok(Math.abs(after.pin[1] - datumC) <= tol, 'the pinned end sits on the datum plane');

  // the annotation reads 3000.
  const annId = r.props.find((p) => p.id === 'dim4').geom.glyphs[0].id;
  const ann = out.svg.match(new RegExp(`<text\\b[^>]*?\\bid="${annId}"[^>]*>[\\s\\S]*?<\\/text>`))[0];
  assert.ok(ann.includes('>3000<'), 'the dim4 annotation reads 3000');

  // no unbound element moved (the established transform-diff pattern):
  // every changed transform belongs to a binding id.
  const tf = (svg) => { const mm = {}; for (const x of svg.matchAll(/<[a-zA-Z][\w:-]*[^>]*?\bid="([^"]+)"[^>]*?\btransform="([^"]*)"/g)) mm[x[1]] = x[2]; return mm; };
  const tClean = tf(clean), tOut = tf(out.svg);
  const boundIds = new Set(tpl.bindings.flatMap((b) => b.ids || []));
  for (const id of Object.keys(tClean)) {
    if (tClean[id] !== tOut[id]) assert.ok(boundIds.has(id), `${id} moved but is not bound`);
  }
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
    + '<path id="p4" transform="matrix(6,8,0,5,10,20)" d="M 0,0 H 40"/>'
    + '<path id="p5" transform="matrix(6,8,0,5,10,20)" d="M 0,0 H -40"/>'
    + '<path id="d1" transform="matrix(1.3333333,0,0,-1.3333333,50,60)" d="M 0,0 L -120.043,197.853"/>'
    + '<path id="d2" transform="matrix(1,0,0,1,10,20)" d="M 0,0 V 40 C 10,50 -10,60 0,70"/>'
    + '<path id="d3" transform="matrix(1,0,0,1,0,0)" d="M 0,0 L 30,40 A 5,5 0 0 1 50,60"/>'
    + '<path id="zero" transform="matrix(0,0,0,1,5,6)" d="M 0,0 H 5"/>'
    + '<path id="t"/></svg>';
  const bindings = [
    { ids: ['p1'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
    { ids: ['p2'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 500 } },
    { ids: ['p3'], param: 'd', geom: { op: 'stretchY', about: 'max', anchor: 100 } },
    { ids: ['p1'], param: 'd', geom: { op: 'shiftX', anchor: 100, pxPerUnit: 0.5 } },
    { ids: ['t'], param: 'd', geom: { op: 'stretchX', anchor: 100 } },
    { ids: ['missing'], param: 'd', geom: { op: 'stretchX', about: 'max', anchor: 100 } },
    { ids: ['p2'], param: 'd', geom: { op: 'stretchX', about: 'middle', anchor: 500 } },
    // #21 axial ops: rotated stretches (both about values, both extent signs),
    // axial shift, and the resilience rows (no extent for about:max, zero axis)
    { ids: ['p4'], param: 'd', geom: { op: 'stretchAxial', about: 'max', anchor: 200 } },
    { ids: ['p5'], param: 'd', geom: { op: 'stretchAxial', about: 'min', anchor: 200 } },
    { ids: ['p4'], param: 'd', geom: { op: 'stretchAxial', anchor: 200 } },
    { ids: ['p4'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.4 } },
    { ids: ['p5'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.4 } },
    { ids: ['t'], param: 'd', geom: { op: 'stretchAxial', about: 'max', anchor: 100 } },
    { ids: ['zero'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.5 } },
    { ids: ['p4'], param: 'd', geom: { op: 'stretchAxial', about: 'middle', anchor: 200 } },
    // #23 d-level ops: axis-aligned matrix with diagonal/curved/arc path data
    // (both about values, the translation fix, the arc resilience row)
    { ids: ['d1'], param: 'd', geom: { op: 'stretchAxial', about: 'max', anchor: 200 } },
    { ids: ['d1'], param: 'd', geom: { op: 'stretchAxial', anchor: 200 } },
    { ids: ['d1'], param: 'd', geom: { op: 'shiftAxial', anchor: 100, pxPerUnit: 0.4 } },
    { ids: ['d2'], param: 'd', geom: { op: 'stretchAxial', about: 'max', anchor: 100 } },
    { ids: ['d3'], param: 'd', geom: { op: 'stretchAxial', anchor: 100 } },
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
  // datum side of the dim1 edit. path4321 is a vertical platform rail: #22's
  // classification replaced "rotated candidate -> ambiguous" and exempted
  // rotated annotation texts, so dim4 (the 900 mm platform height — the old
  // rule forfeited it to the rotated dim-text glyphs of neighbouring dims in
  // its locality box) is no longer ambiguous and its span rule now binds
  // path4321 to dim4, the height it actually measures. The dim1 edit must
  // still leave all three untouched.
  for (const id of ['path4321', 'path7808', 'path4304']) {
    assert.ok(!tpl.bindings.some((b) => (b.ids || []).includes(id) && b.param === 'dim1'), `${id} (datum side) never binds to dim1`);
  }
  const rail = tpl.bindings.find((b) => (b.ids || []).includes('path4321'));
  assert.deepEqual(rail?.geom, { op: 'stretchY', about: 'max', anchor: 900 }, '#22 frees dim4: its platform rail binds the span it measures');

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
