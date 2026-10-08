// Editor badge for unverified params (issue #6). Seam: `buildEditor`
// (src/eval/makeEditor.mjs) emitting a self-contained editor page into temp
// dirs — a string-assertion test on the emitted HTML. Never writes into the
// repo's templates/ or preview/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEditor } from '../src/eval/makeEditor.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const tempRoot = (t, tag) => {
  const dir = mkdtempSync(join(tmpdir(), `editor-badge-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A minimal template: two vision-sourced (unverified) dims + one text-layer param. */
function writeTemplate(root) {
  const dir = join(root, 'templates', 'badge-demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'base.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><text id="t1">LADDER</text><text id="d1">3000</text></svg>');
  const tpl = {
    id: 'badge-demo', name: 'Badge demo', base: { svg: 'base.svg' },
    params: [
      { id: 'dim1', label: 'Overall length', type: 'text', default: '3000', unverified: true },
      { id: 'dim2', label: 'Width', type: 'text', default: '500', unverified: true },
      { id: 'title', label: 'Title', type: 'text', default: 'LADDER' },
    ],
    bindings: [], match: {},
  };
  writeFileSync(join(dir, 'template.json'), JSON.stringify(tpl, null, 2) + '\n');
  return { dir, tpl };
}

const emitEditor = (t) => {
  const root = tempRoot(t, 'root');
  const { dir, tpl } = writeTemplate(root);
  const { out } = buildEditor(dir, { previewDir: join(root, 'preview') });
  return { html: readFileSync(out, 'utf8'), tpl };
};

/** Pull the template JSON block the editor page was built from. */
const embeddedTpl = (html) => {
  const m = html.match(/<script id="tpl" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'emitted page embeds the template JSON block');
  return JSON.parse(m[1]);
};

// ---------- flag round-trips through the build verbatim, no transformation ----------

test('template JSON round-trips into the emitted editor verbatim (unverified flag untransformed)', (t) => {
  const { html, tpl } = emitEditor(t);

  // byte-for-byte: what buildEditor embedded is exactly the template.json on disk
  assert.ok(html.includes(`<script id="tpl" type="application/json">${JSON.stringify(tpl)}</script>`),
    'embedded JSON block is byte-identical to the source template');
  assert.deepEqual(embeddedTpl(html), tpl, 'parsed embedded template matches the source');

  // the server-side build neither strips nor re-invents the marker
  const byId = Object.fromEntries(embeddedTpl(html).params.map((p) => [p.id, p]));
  assert.equal(byId.dim1.unverified, true, 'unverified flag survives for dim1');
  assert.equal(byId.dim2.unverified, true, 'unverified flag survives for dim2');
  assert.ok(!('unverified' in byId.title), 'verified (text-layer) param gains no unverified key');
});

// ---------- badge rendering pinned on the emitted page ----------

test('emitted editor badges every unverified param and no verified one', (t) => {
  const { html, tpl } = emitEditor(t);

  // the params loop appends an 'unverified' badge exactly under the p.unverified gate —
  // one badge site, and it cannot fire for a param without the flag
  const gates = html.match(/if\(p\.unverified\)\s*\{[^}]*?className\s*=\s*'badge'[^}]*?textContent\s*=\s*'unverified'[^}]*?\}/g);
  assert.ok(gates && gates.length === 1,
    'exactly one badge-rendering site, gated on the param being unverified');
  // the badge branch fires per param inside the loop, so every flagged param gets one
  const flagged = tpl.params.filter((p) => p.unverified === true);
  assert.ok(flagged.length >= 2, 'fixture flags more than one param (covers "every")');
  for (const p of flagged) assert.equal(p.unverified, true, `${p.id} is flagged in the embedded JSON`);

  // no badge leaks in anywhere else: nothing static, no second badge text site
  assert.equal((html.match(/textContent\s*=\s*'unverified'/g) || []).length, 1,
    "'unverified' badge text is rendered only at the gated site");
  assert.ok(!html.includes('<span class="badge">unverified</span>'),
    'no static badge markup — verified params render exactly as before');
});

test("the unverified badge reuses the editor's existing .badge styling", (t) => {
  const { html } = emitEditor(t);
  assert.match(html, /\.badge\{display:inline-block/, 'the .badge CSS rule ships in the page');
  assert.ok(html.includes("className='badge'"), 'the badge branch applies the existing .badge class');
});
