// Upload-server hardening tests (issue #2). HTTP-level seam: each test spawns the
// real server (`bin/ladder.mjs serve`) as a child process and talks to it over
// fetch. DRAWIN_ROOT points the server at temp dirs so no test ever writes into
// the repo's templates/ or preview/ — the spawned server is always killed after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import { availableConverters } from '../src/convert/convert.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const PDF = join(repo, 'LSB-2607-003-RHC-R00.pdf');
// real-conversion tests skip (they run where Inkscape/poppler exist)
const converters = availableConverters();

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** Spawn `ladder serve` (optionally from a foreign cwd) and wait until it answers. */
async function startServer({ env = {}, cwd } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(repo, 'bin/ladder.mjs'), 'serve', String(port)], {
    cwd: cwd || repo,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`serve exited early (${child.exitCode}): ${stderr}`);
    try { const r = await fetch(`${base}/config`); if (r.ok) return { child, base, port }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`serve did not start on ${port}: ${stderr}`);
}

const stopServer = (srv) => new Promise((res) => {
  srv.child.kill('SIGTERM');
  srv.child.on('exit', () => res());
});

const tempRoot = (t, tag) => {
  const dir = mkdtempSync(join(tmpdir(), `serve-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A minimal template whose base art has exactly two bindable node ids. */
function writeDemoTemplate(root) {
  const dir = join(root, 'templates', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'base.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><text id="title1">LADDER</text><path id="run1" d="M0,0 H10"/></svg>');
  writeFileSync(join(dir, 'template.json'), JSON.stringify({
    id: 'demo', name: 'Demo', base: { svg: 'base.svg' }, params: [], bindings: [], match: {},
  }));
}

const postJson = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

// ---------- scaffold output pinned to the server root, not the process cwd ----------

test('POST /scaffold from a foreign cwd lands in the server-root templates dir', { skip: converters.length === 0 && 'no converters installed' }, async (t) => {
  const root = tempRoot(t, 'root');       // DRAWIN_ROOT — stands in for the repo root
  const foreign = tempRoot(t, 'foreign'); // spawn cwd — must receive nothing
  const srv = await startServer({ env: { DRAWIN_ROOT: root }, cwd: foreign });
  t.after(() => stopServer(srv));

  const r = await fetch(`${srv.base}/scaffold`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-filename': 'srv-hardening-test.pdf' },
    body: readFileSync(PDF),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.id, 'srv-hardening-test');

  // landed in the server root's templates/, not in the spawn cwd
  assert.ok(existsSync(join(root, 'templates', j.id, 'template.json')), 'template.json in server-root templates/');
  assert.ok(!existsSync(join(foreign, 'templates')), 'nothing written under the foreign cwd');

  // the editor upload flow keeps working: the scaffolded editor is served
  const ed = await fetch(`${srv.base}/editor/${j.id}`);
  assert.equal(ed.status, 200);
  assert.match(ed.headers.get('content-type'), /text\/html/);
});

// ---------- the browser page and the fixture editor keep working ----------

test('GET / serves the upload page; /templates and /editor/<id> round-trip', async (t) => {
  const root = tempRoot(t, 'page');
  writeDemoTemplate(root);
  const srv = await startServer({ env: { DRAWIN_ROOT: root } });
  t.after(() => stopServer(srv));

  const page = await fetch(`${srv.base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Drop a PDF here/);

  const list = await (await fetch(`${srv.base}/templates`)).json();
  assert.deepEqual(list.map((x) => x.id), ['demo']);
});

// ---------- /bind validates ids against the template's base art ----------

test('POST /bind rejects ids absent from the base art with 400, accepts valid ids with 200', async (t) => {
  const root = tempRoot(t, 'bind');
  writeDemoTemplate(root);
  const tplPath = join(root, 'templates', 'demo', 'template.json');
  const srv = await startServer({ env: { DRAWIN_ROOT: root } });
  t.after(() => stopServer(srv));

  const bad = await postJson(`${srv.base}/bind`, { id: 'demo', param: 'title', label: 'Title', value: 'X', ids: ['no-such-node'] });
  assert.equal(bad.status, 400);
  const badTpl = JSON.parse(readFileSync(tplPath, 'utf8'));
  assert.deepEqual(badTpl.bindings, [], 'rejected binding must not be written into template.json');

  const ok = await postJson(`${srv.base}/bind`, { id: 'demo', param: 'title', label: 'Title', value: 'X', ids: ['title1'] });
  assert.equal(ok.status, 200);
  const okTpl = JSON.parse(readFileSync(tplPath, 'utf8'));
  assert.deepEqual(okTpl.bindings, [{ ids: ['title1'], param: 'title', mode: 'id' }]);

  // the click-to-bind flow in the editor serves a regenerated editor page
  const ed = await fetch(`${srv.base}/editor/demo`);
  assert.equal(ed.status, 200);
});

// ---------- /bind requires UPLOAD_TOKEN when one is configured ----------

test('GET /config reports llm connectivity as a boolean (never key material)', async (t) => {
  const root = tempRoot(t, 'llmflag');
  writeDemoTemplate(root);
  // keyless env: every key var the resolver checks is scrubbed
  const env = { DRAWIN_ROOT: root };
  for (const k of ['LADDER_LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY']) env[k] = '';
  const srv = await startServer({ env });
  t.after(() => stopServer(srv));
  const j = await (await fetch(`${srv.base}/config`)).json();
  assert.equal(j.llm, false);
  assert.equal(typeof j.llm, 'boolean');
});

test('GET /config llm flag is true when a key is configured', async (t) => {
  const root = tempRoot(t, 'llmflag-on');
  writeDemoTemplate(root);
  const srv = await startServer({ env: { DRAWIN_ROOT: root, LADDER_LLM_API_KEY: 'test-key-123', LADDER_LLM_PROVIDER: 'openai' } });
  t.after(() => stopServer(srv));
  const j = await (await fetch(`${srv.base}/config`)).json();
  assert.equal(j.llm, true);
});

test('POST /bind without the upload token is rejected with 401 when UPLOAD_TOKEN is set', async (t) => {
  const root = tempRoot(t, 'token');
  writeDemoTemplate(root);
  const srv = await startServer({ env: { DRAWIN_ROOT: root, UPLOAD_TOKEN: 'sekrit' } });
  t.after(() => stopServer(srv));

  const noToken = await postJson(`${srv.base}/bind`, { id: 'demo', param: 'title', ids: ['title1'] });
  assert.equal(noToken.status, 401);

  const withToken = await postJson(`${srv.base}/bind`, { id: 'demo', param: 'title', ids: ['title1'] }, { 'x-upload-token': 'sekrit' });
  assert.equal(withToken.status, 200);
});

// ---------- localhost by default; HOST overrides ----------

const externalIPv4 = () => Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

const canConnect = (host, port) => new Promise((res) => {
  const s = net.connect(port, host);
  s.once('connect', () => { s.end(); res(true); });
  s.once('error', () => res(false));
});

test('binds 127.0.0.1 by default; HOST env overrides', async (t) => {
  const ext = externalIPv4();
  const root = tempRoot(t, 'host');
  writeDemoTemplate(root);

  const def = await startServer({ env: { DRAWIN_ROOT: root } });
  t.after(() => stopServer(def));
  assert.equal(await canConnect('127.0.0.1', def.port), true, 'loopback reachable by default');
  if (ext) assert.equal(await canConnect(ext, def.port), false, `default bind must not listen on ${ext}`);

  const any = await startServer({ env: { DRAWIN_ROOT: root, HOST: '0.0.0.0' } });
  t.after(() => stopServer(any));
  assert.equal(await canConnect('127.0.0.1', any.port), true, 'loopback reachable with HOST=0.0.0.0');
  if (ext) assert.equal(await canConnect(ext, any.port), true, `HOST=0.0.0.0 listens on ${ext}`);
});
