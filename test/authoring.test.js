// Authoring-step tests: mergeGlyphTexts rebuilds word runs from per-glyph
// <text> elements (issue #19) using the shipped font's own advance widths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeGlyphTexts } from '../src/templates/authoring.mjs';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = availableConverters();

// Build a glyph-split <text> per character, positions from the same ADVANCE
// table the merger uses (font-size 10, unit scale — 1 em = 10 user units).
const ADVANCE = { ' ': 278, 'C': 722, 'O': 778, 'N': 722, 'S': 667, 'T': 611, 'R': 722, 'U': 722, 'D': 722, 'B': 667, 'H': 722, 'F': 611, 'L': 556, 'I': 278, 'M': 833, 'E': 667, 'W': 944, 'A': 667, 'G': 778, '0': 556, '5': 556, '.': 278 };
const EM = 10;
const glyphTexts = (str, x0, y, { rotate = false, track = 0 } = {}) => {
  let x = x0, n = 0, out = '';
  for (const ch of str) {
    if (ch !== ' ') {
      const tf = rotate ? `matrix(0,-1,1,0,${x},${y})` : `matrix(1,0,0,1,${x.toFixed(3)},${y})`;
      out += `<text xml:space="preserve" transform="${tf}" clip-path="url(#clip${n})"><tspan id="ts${n}" style="font-size:10px" x="0" y="0">${ch}</tspan></text>`;
      n++;
    }
    x += ((ADVANCE[ch] ?? 556) / 1000 + track) * EM;
  }
  return out;
};
const DOC = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

test('mergeGlyphTexts rebuilds a glyph-split title string with word spaces', () => {
  const svg = DOC(glyphTexts('FHL CONSTRUCTION SDN BHD', 50, 100));
  const r = mergeGlyphTexts(svg);
  assert.equal(r.merged, 1, 'one line segment');
  assert.ok(r.svg.includes('>FHL CONSTRUCTION SDN BHD</tspan>'), 'whole string in one run');
  assert.equal((r.svg.match(/<text\b/g) || []).length, 1, 'glyph elements collapsed into the first');
  assert.ok(!r.svg.includes('clip-path='), 'per-glyph clip paths dropped on the merged run');
});

test('mergeGlyphTexts rebuilds tracked (letter-spaced) text as a clean string', () => {
  // +0.04em tracking between every glyph — like the 004 title block
  const svg = DOC(glyphTexts('ALUMINIUM CAT LADDER', 50, 100, { track: 0.04 }));
  const r = mergeGlyphTexts(svg);
  assert.equal(r.merged, 1);
  assert.ok(r.svg.includes('>ALUMINIUM CAT LADDER</tspan>'), 'tracking joins letters, word gaps stay spaces');
});

test('mergeGlyphTexts breaks segments at object boundaries (large gap)', () => {
  const svg = DOC(glyphTexts('HELLO', 50, 100) + glyphTexts('WORLD', 50 + 12 * EM, 100));
  const r = mergeGlyphTexts(svg);
  assert.equal(r.merged, 2);
  assert.ok(r.svg.includes('>HELLO</tspan>'));
  assert.ok(r.svg.includes('>WORLD</tspan>'));
});

test('mergeGlyphTexts leaves healthy whole-string text byte-identical', () => {
  const svg = DOC('<text transform="matrix(1,0,0,1,50,100)"><tspan style="font-size:10px">FHL CONSTRUCTION SDN BHD</tspan></text>');
  const r = mergeGlyphTexts(svg);
  assert.equal(r.merged, 0);
  assert.equal(r.svg, svg);
});

test('mergeGlyphTexts leaves rotated text and lone glyphs alone', () => {
  const svg = DOC(glyphTexts('HELLO', 50, 100, { rotate: true }) + glyphTexts('A', 200, 300));
  const r = mergeGlyphTexts(svg);
  assert.equal(r.merged, 0);
  assert.equal(r.svg, svg);
});

// ---------- real art (Inkscape-gated): the issue #19 repro ----------

test('scaffold 004 recovers title-block fields from a glyph-split conversion', { skip: !tools.includes('inkscape') && 'requires inkscape' }, async () => {
  const { scaffold } = await import('../src/eval/scaffold.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-merge-'));
  const r = await scaffold(join(repo, 'LSB-2607-004-FHL-R00.pdf'), { llm: false, id: 'merge-004', templatesDir: tmp });
  const ids = r.props.map((p) => p.id);
  for (const id of ['drawingNo', 'customer', 'workingLoad', 'productName']) {
    assert.ok(ids.includes(id), `${id} proposed (got: ${ids.join(',')})`);
  }
  const product = r.props.find((p) => p.id === 'productName');
  assert.match(product.value, /CAT LADDER/, 'product name is the real title, not a fallback');
});
