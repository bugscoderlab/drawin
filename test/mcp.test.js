// MCP server test (PLAN 2.5): stdio handshake, tools/list, tools/call over
// newline-delimited JSON-RPC. import_ladder_pdf needs poppler for the corpus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasPoppler } from '../src/extract/text.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function mcpSession() {
  const proc = spawn(process.execPath, [join(repo, 'bin', 'mcp.mjs')], { cwd: repo });
  let buf = '';
  const pending = [];
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) pending.shift()?.(JSON.parse(line));
    }
  });
  const call = (method, params, id) => new Promise((res) => {
    pending.push(res);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, method, params }) + '\n');
  });
  return { call, stop: () => proc.kill() };
}

test('mcp: initialize + tools/list + import_ladder_pdf round-trip', { skip: !hasPoppler() && 'poppler not installed' }, async () => {
  const s = mcpSession();
  try {
    const init = await s.call('initialize');
    assert.equal(init.result.serverInfo.name, 'laddertech-drawin');
    assert.ok(init.result.capabilities.tools);

    const list = await s.call('tools/list');
    const tool = list.result.tools.find((t) => t.name === 'import_ladder_pdf');
    assert.ok(tool, 'import_ladder_pdf is listed');
    assert.ok(tool.inputSchema.required.includes('pdfPath'));

    const got = await s.call('tools/call', {
      name: 'import_ladder_pdf',
      arguments: { pdfPath: join(repo, 'LSB-2607-004-FHL-R00.pdf'), llm: 'off' },
    }, 2);
    const r = JSON.parse(got.result.content[0].text);
    assert.equal(r.module, 'cage');
    assert.equal(r.params.drawingNo, 'LSB/2607/004/FHL/R00');
    assert.equal(r.params.floorToLanding, 6650);
    assert.ok(r.confidence.drawingNo.source === 'rules');

    const bad = await s.call('tools/call', { name: 'nope', arguments: {} }, 3);
    assert.equal(bad.error.code, -32602);
  } finally {
    s.stop();
  }
});
