#!/usr/bin/env node
// MCP server over stdio (newline-delimited JSON-RPC) — exposes the extraction
// pipeline to MCP clients (OpenCode, Claude Desktop, …). Headless: requires
// poppler; vision fill requires an LLM key in .env (rules-only otherwise).
//
//   node bin/mcp.mjs            # stdio transport
//
// Tools:
//   import_ladder_pdf { pdfPath, llm?: 'auto'|'off'|'whole' }
//     -> extractParams result: { file, profile, module, params, core,
//        confidence, warnings, unmappedText }

import readline from 'node:readline';
import { resolve } from 'node:path';

import { extractParams } from '../src/extract/extract.mjs';

const TOOLS = [{
  name: 'import_ladder_pdf',
  title: 'Import ladder PDF',
  description: 'Extract structured params from a Laddertech ladder drawing PDF (title block + dimension callouts). Returns params, per-field confidence, and warnings. Vision fill requires LADDER_LLM_* in .env; rules-only without it.',
  inputSchema: {
    type: 'object',
    properties: {
      pdfPath: { type: 'string', description: 'absolute or cwd-relative path to the PDF' },
      llm: { type: 'string', enum: ['auto', 'off', 'whole'], description: "auto = vision fills rule blanks when a key is configured (default); off = rules only; whole = vision for every field" },
    },
    required: ['pdfPath'],
    additionalProperties: false,
  },
}];

const handlers = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'laddertech-drawin', version: '0.1.0' },
  }),
  'tools/list': () => ({ tools: TOOLS }),
  'notifications/initialized': () => null,
  'notifications/cancelled': () => null,
  'tools/call': async (args) => {
    const { name, arguments: callArgs } = args ?? {};
    if (name !== 'import_ladder_pdf') throw rpcError(-32602, `unknown tool: ${name}`);
    const { pdfPath, llm = 'auto' } = callArgs ?? {};
    if (!pdfPath) throw rpcError(-32602, 'pdfPath is required');
    const r = await extractParams(resolve(pdfPath), { llm });
    return {
      content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
      structuredContent: r,
    };
  },
};

function rpcError(code, message) {
  const e = new Error(message);
  e.rpc = { code, message };
  return e;
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method?.startsWith('notifications/')) {
    await handlers[msg.method]?.(msg.params);
    return;
  }
  const reply = (result, error) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...(error ? { error } : { result }) }) + '\n');
  };
  try {
    const result = await handlers[msg.method]?.(msg.params);
    if (result === null && !handlers[msg.method]) reply(null, { code: -32601, message: `method not found: ${msg.method}` });
    else reply(result ?? {});
  } catch (e) {
    reply(null, e.rpc ?? { code: -32603, message: String(e.message ?? e) });
  }
});
