// LLM part-binding proposal tests (spec #15): the model picks membership
// (spans vs attached) from the deterministic stage's candidate pool; the
// engine derives ops, about ends, and calibration. Fake-call injection only —
// no network, no key required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { proposeGeometry } from '../src/eval/scaffold.mjs';
import { proposeLlmParts, mergeLlmParts } from '../src/eval/partsLlm.mjs';
import { renderTemplate } from '../src/templates/render.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = availableConverters();

// One horizontal dim (line extent 250 px, value 2500, datum end LEFT at
// x=100, moving end at x=350). barL/barR match the span rule (claimed by the
// deterministic stage). crossL/crossR cross the moving plane and the plate
// sits off-plane on the moving side — all three are rule-skipped and become
// LLM candidates.
const llmSvg = '<svg xmlns="http://www.w3.org/2000/svg">'
  + '<path id="line1" transform="matrix(1,0,0,1,100,200)" d="M 0,0 H 250"/>'
  + '<path id="a1" d="M 0,0 l 8,2 -8,2 z" transform="matrix(1,0,0,1,96,198)"/>'
  + '<path id="a2" d="M 0,0 l -8,2 8,2 z" transform="matrix(1,0,0,1,350,198)"/>'
  + '<path id="barL" transform="matrix(1,0,0,1,98,220)" d="M 0,0 H 246"/>'
  + '<path id="barR" transform="matrix(1,0,0,1,352,230)" d="M 0,0 H -246"/>'
  + '<path id="crossL" transform="matrix(1,0,0,1,100,260)" d="M 0,0 H 80"/>'
  + '<path id="crossR" transform="matrix(1,0,0,1,380,270)" d="M 0,0 H -80"/>'
  + '<path id="plate" transform="matrix(1,0,0,1,380,240)" d="M 0,0 H 20"/>'
  + '</svg>';
const llmRows = [
  { id: 'line1', x: 100, y: 200, w: 250, h: 0.5 },
  { id: 'a1', x: 96, y: 198, w: 8, h: 4 },
  { id: 'a2', x: 346, y: 198, w: 8, h: 4 },
  { id: 'barL', x: 98, y: 220, w: 246, h: 1 },
  { id: 'barR', x: 106, y: 230, w: 246, h: 1 },
  { id: 'crossL', x: 100, y: 260, w: 80, h: 1 },
  { id: 'crossR', x: 300, y: 270, w: 80, h: 1 },
  { id: 'plate', x: 380, y: 240, w: 20, h: 1 },
];
const llmProps = [{ id: 'dim1', value: '2500', geom: { vertical: false, glyphs: [{ id: 't1', x: 205, y: 196 }, { id: 't2', x: 213, y: 196 }] } }];

// Runs the deterministic stage and returns its internals for the LLM pass.
function stage3(llmExtraSvg = '', llmExtraRows = []) {
  const g = proposeGeometry([...llmRows, ...llmExtraRows], llmProps, llmSvg + llmExtraSvg);
  return { g, rec: g.recs.find((r) => r.p.id === 'dim1') };
}

const fakeLLM = (reply, calls = []) => async (req) => { calls.push(req); return { text: JSON.stringify(typeof reply === 'function' ? reply(req) : reply) }; };

test('llm picks: spans -> stretch with the datum-side about end (both orientations)', async () => {
  const { g, rec } = stage3();
  assert.equal(g.parts[0].bound, 2, 'rules bind the two span bars first');
  const lp = await proposeLlmParts({
    recs: [rec], usable: g.usable, claimed: g.claimed, matrixOf: g.matrixOf,
    call: fakeLLM({ spans: ['crossL', 'crossR'] }),
  });
  assert.equal(lp.summary.bound, 2);
  const crossL = lp.bindings.find((b) => b.ids[0] === 'crossL');
  const crossR = lp.bindings.find((b) => b.ids[0] === 'crossR');
  // crossL's local origin sits at the datum plane -> "min" pins it; crossR's
  // origin is at the moving end (path extends negative) -> "max" pins the far
  // (datum) end. Identical derivation to the deterministic span rule.
  assert.deepEqual(crossL.geom, { op: 'stretchX', about: 'min', anchor: 2500 });
  assert.deepEqual(crossR.geom, { op: 'stretchX', about: 'max', anchor: 2500 });
  // accepted ids join the claimed set
  assert.ok(g.claimed.has('crossL') && g.claimed.has('crossR'));
});

test('llm picks: attached -> shift at the full self-calibrated rate', async () => {
  const { g, rec } = stage3();
  const lp = await proposeLlmParts({
    recs: [rec], usable: g.usable, claimed: g.claimed, matrixOf: g.matrixOf,
    call: fakeLLM({ attached: ['plate'] }),
  });
  assert.deepEqual(lp.bindings[0].geom, { op: 'shiftX', anchor: 2500, pxPerUnit: 250 / 2500 });
  // the produced binding renders like any rule-proposed one
  const { report } = renderTemplate(llmSvg, lp.bindings, { dim1: '3000' });
  assert.ok(report.every((x) => x.ok));
});

test('llm picks: unknown, claimed, and picked-twice ids are rejected and reported', async () => {
  const { g, rec } = stage3();
  const lp = await proposeLlmParts({
    recs: [rec], usable: g.usable, claimed: g.claimed, matrixOf: g.matrixOf,
    call: fakeLLM({ spans: ['noSuchId', 'barL', 'plate'], attached: ['plate'] }),
  });
  // only the first pick of 'plate' binds
  assert.deepEqual(lp.bindings.map((b) => b.ids[0]), ['plate']);
  const reasons = Object.fromEntries(lp.rejected.map((r) => [r.id, r.reason]));
  assert.equal(reasons.noSuchId, 'not an eligible candidate');
  assert.equal(reasons.barL, 'not an eligible candidate', 'rule-bound ids are claimed and leave the candidate pool');
  assert.equal(reasons.plate, 'picked twice');
  assert.equal(lp.summary.rejected, 3);
});

test('llm pass: a dim with no candidates is not asked', async () => {
  const { g, rec } = stage3();
  const calls = [];
  const lp = await proposeLlmParts({
    recs: [rec], usable: [], claimed: g.claimed, matrixOf: g.matrixOf,
    call: fakeLLM({ spans: [] }, calls),
  });
  assert.equal(lp, null);
  assert.equal(calls.length, 0);
});

test('llm pass: no key and no fake call -> quiet no-op', async () => {
  const { g, rec } = stage3();
  const keyVars = ['LADDER_LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'];
  const saved = keyVars.map((k) => [k, process.env[k]]);
  // '' not delete: an absent var would be refilled from a real .env by loadEnv
  for (const [k] of saved) process.env[k] = '';
  try {
    assert.equal(await proposeLlmParts({ recs: [rec], usable: g.usable, claimed: g.claimed, matrixOf: g.matrixOf }), null);
  } finally {
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('llm pass: a throwing call never fails the pass', async () => {
  const { g, rec } = stage3();
  const lp = await proposeLlmParts({
    recs: [rec], usable: g.usable, claimed: g.claimed, matrixOf: g.matrixOf,
    call: async () => { throw new Error('provider down'); },
  });
  assert.equal(lp, null);
});

test('merge: counts split by provenance, ambiguous flag preserved, ids join the fresh set', () => {
  const parts = [{ param: 'dim1', bound: 2, skipped: 5 }, { param: 'dim2', bound: 0, skipped: 9, ambiguous: true }];
  const tplBindings = [];
  const fresh = new Set(['barL']);
  const lp = {
    bindings: [
      { ids: ['crossL'], param: 'dim1', geom: { op: 'stretchX', about: 'min', anchor: 2500 } },
      { ids: ['plate'], param: 'dim2', geom: { op: 'shiftX', anchor: 700, pxPerUnit: 0.1 } },
    ],
    byDim: { dim1: 1, dim2: 1 },
    rejected: [], summary: { asked: 2, bound: 2, rejected: 0 },
  };
  const { parts: merged, freshGeomIds } = mergeLlmParts(parts, tplBindings, fresh, lp);
  assert.deepEqual(merged, [
    { param: 'dim1', bound: 3, skipped: 5, llm: 1 },
    { param: 'dim2', bound: 1, skipped: 9, ambiguous: true, llm: 1 },
  ], 'llm bindings count but the dim stays flagged ambiguous');
  assert.equal(tplBindings.length, 2);
  assert.ok(freshGeomIds.has('crossL') && freshGeomIds.has('plate') && freshGeomIds.has('barL'));
});

// ---------- real art: 004 (Inkscape-gated) ----------

test('scaffold 004 with a fake llm: bogus ids rejected; rungs are legitimate candidates the rules alone leave unbound', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const pdf = join(repo, 'LSB-2607-004-FHL-R00.pdf');
  assert.ok(exists(pdf), '004 evidence PDF at repo root');
  const { scaffold, reportScaffold } = await import('../src/eval/scaffold.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-llm-parts-'));
  const calls = [];
  const r1 = await scaffold(pdf, {
    llm: false, id: 'geo-llm', templatesDir: tmp,
  });
  assert.equal(r1.llmParts.asked, 0, 'opts.llm === false gates the pass');
  const rungBound = (dir) => JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8')).bindings
    .some((b) => (b.ids || []).includes('path4324'));
  assert.ok(!rungBound(join(tmp, 'geo-llm')), 'rules alone leave the rungs unbound (span tolerance)');
  // the dim line's own id (claimed by the annotation stage) must be unproposable
  const dimLineId = JSON.parse(readFileSync(join(tmp, 'geo-llm', 'template.json'), 'utf8')).bindings
    .find((b) => b.param === 'dim1' && b.geom?.op === 'stretchX').ids[0];

  const r2 = await scaffold(pdf, {
    llm: fakeLLM((req) => {
      // the fake answers EVERY eligible dim — only dim1 gets picks: the first
      // id from dim1's own candidate table (parsed out of the prompt), plus
      // two ids that must be rejected.
      const asked = req.text.match(/Dimension "(dim\d+)"/)?.[1];
      if (asked !== 'dim1') return {};
      const firstCand = req.text.split('\n').find((l) => /^(path|text|tspan)\w*\d+\s+-?[\d.]/.test(l))?.split(/\s+/)[0];
      return { spans: [firstCand], attached: ['noSuchId', dimLineId] };
    }, calls),
    id: 'geo-llm', templatesDir: tmp, force: true,
  });
  assert.ok(calls.length > 0, 'the fake was asked for skipped-heavy dims');
  assert.ok(calls.some((c) => /Dimension "dim2"/.test(c.text)), 'ambiguous dims are asked too');
  // an id from dim1's own candidate table is accepted and engine-calibrated;
  // a nonexistent id and the claimed dim-line id are rejected
  assert.equal(r2.llmParts.bound, 1, 'membership is the model call, math is the engine\'s');
  assert.equal(r2.llmParts.rejected, 2);
  const d1 = r2.parts.find((d) => d.param === 'dim1');
  assert.equal(d1.llm, 1, 'dim1 shows the llm provenance split');
  const picked = r2.llmParts && calls.find((c) => /Dimension "dim1"/.test(c.text)).text.split('\n')
    .find((l) => /^(path|text|tspan)\w*\d+\s+-?[\d.]/.test(l))?.split(/\s+/)[0];
  assert.ok(picked, 'parsed a candidate from the prompt');
  const boundNow = JSON.parse(readFileSync(join(tmp, 'geo-llm', 'template.json'), 'utf8')).bindings
    .some((b) => (b.ids || []).includes(picked));
  assert.ok(boundNow, 'the picked id is bound in the fresh template');
  const lines = [];
  reportScaffold(r2, (s) => lines.push(s));
  assert.ok(lines.some((s) => /llm parts :/.test(s)), 'the report shows the llm line');
  const { renderById } = await import('../src/templates/renderCmd.mjs');
  const out = await renderById(tmp, 'geo-llm', { dim1: '1000' });
  assert.ok(out.report.filter((x) => x.ok === false).length === 0, 'template still renders cleanly');
});

function exists(f) {
  try { readFileSync(f); return true; } catch { return false; }
}
