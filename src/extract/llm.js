// Provider-agnostic LLM adapter for field extraction (PLAN.md §1B).
// Dependency-free: uses the global fetch in Node 22.
//
// Supports: openai | anthropic | gemini (google_genai) | local (OpenAI-compatible)
// Never called from the browser. Keys come from src/config/env.mjs.

import { llmConfig } from '../config/env.mjs';

/** One chat/turn call. `image` = { base64, mimeType } (optional). Returns { text, raw }. */
export async function callLLM({ system, text, image, json = true, maxTokens = 3000, temperature = 0, signal } = {}) {
  const cfg = llmConfig();
  if (!cfg.hasKey) {
    throw new Error(`No API key found. Looked in: ${cfg.keyVars.join(', ')}. Add it to .env.`);
  }
  switch (cfg.provider) {
    case 'gemini':    return callGemini(cfg, { system, text, image, json, maxTokens, temperature, signal });
    case 'anthropic': return callAnthropic(cfg, { system, text, image, json, maxTokens, temperature, signal });
    case 'openai':
    case 'local':
    default:          return callOpenAI(cfg, { system, text, image, json, maxTokens, temperature, signal });
  }
}

// --- Gemini (native Generative Language API) --------------------------------
async function callGemini(cfg, { system, text, image, json, maxTokens, temperature, signal }) {
  const parts = [];
  if (text) parts.push({ text });
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const r = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const j = await r.json();
  const t = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  return { text: t, raw: j, usage: j?.usageMetadata };
}

// --- OpenAI-compatible (/chat/completions) ----------------------------------
async function callOpenAI(cfg, { system, text, image, json, maxTokens, temperature, signal }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  const content = [];
  if (text) content.push({ type: 'text', text });
  if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } });
  messages.push({ role: 'user', content: content.length === 1 && content[0].type === 'text' ? content[0].text : content });

  const body = { model: cfg.model, messages, temperature, max_tokens: maxTokens };
  if (json) body.response_format = { type: 'json_object' };

  const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const j = await r.json();
  return { text: j?.choices?.[0]?.message?.content ?? '', raw: j, usage: j?.usage };
}

// --- Anthropic Messages API -------------------------------------------------
async function callAnthropic(cfg, { system, text, image, json, maxTokens, temperature, signal }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } });
  if (json) content.push({ type: 'text', text: 'Respond with JSON only.' });

  const body = { model: cfg.model, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content }] };
  if (system) body.system = system;

  const r = await fetch(`${cfg.baseUrl}/messages`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const j = await r.json();
  return { text: j?.content?.map((c) => c.text).filter(Boolean).join('') ?? '', raw: j, usage: j?.usage };
}

/** Parse a model reply into JSON, tolerating ```json fences. */
export function parseJSON(text) {
  if (!text) throw new Error('Empty model reply');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}
