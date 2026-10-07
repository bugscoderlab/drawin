// Minimal, dependency-free .env loader + LLM config resolver.
// Used by the CLI only — keys are never shipped to the browser.
//
// Usage:
//   import { llmConfig, maskKey } from './src/config/env.mjs';
//   const cfg = llmConfig();           // loads ./.env if present
//   if (!cfg.hasKey) { /* LLM disabled */ }

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse a .env file into an object and populate process.env (real env wins). */
export function loadEnv(file = resolve(ROOT, '.env')) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
    if (k && !(k in process.env)) process.env[k] = v;
  }
  return out;
}

// Accept the provider IDs used by common SDKs / tools.
const ALIASES = {
  openai: 'openai',
  anthropic: 'anthropic', claude: 'anthropic',
  gemini: 'gemini', google: 'gemini', 'google-genai': 'gemini', google_genai: 'gemini', googlegenai: 'gemini',
  local: 'local', ollama: 'local', lmstudio: 'local',
};

const PROVIDERS = {
  openai:    { keyVars: ['OPENAI_API_KEY'],                            baseUrl: 'https://api.openai.com/v1',                        model: 'gpt-4o-mini' },
  anthropic: { keyVars: ['ANTHROPIC_API_KEY'],                         baseUrl: 'https://api.anthropic.com/v1',                     model: 'claude-3-5-haiku-latest' },
  gemini:    { keyVars: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'], baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  local:     { keyVars: ['LADDER_LLM_API_KEY'],                        baseUrl: 'http://localhost:11434/v1',                        model: 'llama3.1' },
};

/** Resolve canonical provider + model + key from env (loading .env first). */
export function llmConfig() {
  loadEnv();
  const raw = (process.env.LADDER_LLM_PROVIDER || 'openai').toLowerCase();
  const provider = ALIASES[raw];
  if (!provider) {
    throw new Error(`Unknown LADDER_LLM_PROVIDER: ${raw} (use ${[...new Set(Object.values(ALIASES))].join('|')})`);
  }
  const p = PROVIDERS[provider];
  const candidates = ['LADDER_LLM_API_KEY', ...p.keyVars];
  let apiKey = '';
  let keyVar = '(none)';
  for (const v of candidates) {
    if (process.env[v]) { apiKey = process.env[v]; keyVar = v; break; }
  }
  return {
    provider,
    providerAlias: raw,
    model: process.env.LADDER_LLM_MODEL || p.model,
    baseUrl: process.env.LADDER_LLM_BASE_URL || p.baseUrl,
    apiKey,
    hasKey: apiKey.length > 0,
    keyVar,
    keyVars: candidates,
  };
}

/** Safe for logs: show only a short fingerprint, never the full key. */
export function maskKey(k) {
  if (!k) return '(none)';
  const head = k.slice(0, 4);
  const tail = k.length > 8 ? k.slice(-4) : '';
  return `${head}…${tail} (${k.length} chars)`;
}
