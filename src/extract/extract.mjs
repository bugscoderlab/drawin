// Extraction orchestrator (PLAN 1.6 + 1B): pdftotext -> stitch -> fields ->
// profile fixes -> optional ONE vision pass filling rule blanks (never a
// second call) -> validation against the core ranges.
//
//   const r = await extractParams(pdfPath)                    // rules; vision if a key is configured
//   const r = await extractParams(pdfPath, { llm: 'whole' })  // force vision for every field
//   const r = await extractParams(pdfPath, { llm: 'off' })    // rules only
//
// Output: { file, profile, module, params, core, confidence, warnings, unmappedText }
// — never throws for an unrecognised drawing; missing fields are null and
// reported, because layers 1–2 must always succeed.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { pdftotext, hasPoppler } from './text.mjs';
import { stitchText } from './stitch.mjs';
import { extractRules } from './rules.mjs';
import { applyProfile } from './profiles.mjs';
import { parseNumber, parseLoad, parseAngle, parseDate } from './normalize.mjs';
import { callLLM, parseJSON } from './llm.js';
import { llmConfig } from '../config/env.mjs';
import { rangeError } from '../core/modules.mjs';

// Concise field semantics for the LLM (measured: concise 6/6, verbose 1/6).
const DESC = {
  productType: 'one of trolley|cat|cage. cage = a ladder fitted with a safety cage / full hoops around the climb; cat = a plain cat ladder body only, no cage; trolley = a mobile step platform on castors',
  drawingNo: 'the Laddertech drawing number (starts LSB)',
  revision: 'string', customer: 'the company named in the Customer field', productName: 'the drawing TITLE line',
  material: 'string', finishing: 'string', date: 'string', workingLoad: 'string e.g. "150KG"',
  steps: 'integer', angle: 'string e.g. "60"',
  overallHeight: 'overall (tallest) vertical dimension, mm',
  platformLength: 'top platform length, mm — the horizontal dimension at the platform in the side elevation',
  overallWidth: 'overall width across the FRONT elevation, mm',
  footprint: 'overall base length along the floor in the side elevation, mm',
  floorToLanding: 'from the "Height : A + B" note, the FIRST (larger) number, mm',
  handrailHeight: 'from the "Height : A + B" note, the SECOND (smaller) number, mm',
  ladderWidth: 'ladder outside width (front elevation), mm',
};

// Field sets per module (what a complete extraction looks like).
export const FIELDS = {
  trolley: ['productType', 'drawingNo', 'revision', 'customer', 'productName', 'steps', 'angle',
    'overallHeight', 'workingLoad', 'platformLength', 'overallWidth', 'footprint', 'material', 'finishing'],
  cage: ['productType', 'drawingNo', 'revision', 'customer', 'material', 'finishing', 'workingLoad',
    'floorToLanding', 'handrailHeight', 'ladderWidth'],
  cat: ['productType', 'drawingNo', 'revision', 'customer', 'productName', 'material', 'finishing',
    'workingLoad', 'date', 'overallHeight'],
};

// Extracted field -> core generator field id (for `ladder generate`).
export const CORE_MAP = {
  trolley: { steps: 'steps', angle: 'angle', platformLength: 'platformLength', overallWidth: 'trolleyWidth', footprint: 'footprint' },
  cage: { floorToLanding: 'cageLadderHeight', handrailHeight: 'cageHandrailHeight', ladderWidth: 'cageWidth' },
  cat: {},
};

const SYSTEM = `You read ladder shop drawings and return JSON {"fields":{<field>:value}}.
Use ONLY values present in the source; never invent or round. Read dimension callouts digit by digit.`;
const promptFor = (mod) =>
  `Extract:\n${FIELDS[mod].map((f) => `- ${f}: ${DESC[f] || 'string'}`).join('\n')}\nReturn JSON.`;

/** Typed normalization per field (kept small: the rules already shape values). */
const TYPERS = {
  steps: (v) => { const n = parseNumber(v); return n === null ? null : Math.round(n); },
  overallHeight: parseNumber, floorToLanding: parseNumber, handrailHeight: parseNumber,
  ladderWidth: parseNumber, platformLength: parseNumber, overallWidth: parseNumber, footprint: parseNumber,
  workingLoad: parseLoad, angle: parseAngle, date: parseDate,
};

function typeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') { out[k] = null; continue; }
    out[k] = TYPERS[k] ? TYPERS[k](v) : v;
  }
  return out;
}

/** Render page 1 to PNG at dpi (vision input). pdftocairo; null when absent. */
function pngOf(file, dpi = 200) {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'ladder-'));
    const out = join(dir, 'page');
    execFileSync('pdftocairo', ['-png', '-r', String(dpi), '-singlefile', file, out], { stdio: ['ignore', 'pipe', 'ignore'] });
    const buf = readFileSync(out + '.png');
    return { base64: buf.toString('base64'), mimeType: 'image/png', bytes: buf.length };
  } catch { return null; }
}

// --- vision fill (1B) -------------------------------------------------------
const cachePath = (dir, pdf, mod, prompt) =>
  join(dir, createHash('sha1').update(`${pdf}:${mod}:${prompt}`).digest('hex') + '.json');

async function visionFill(pdfPath, module, blanks, { cacheDir }) {
  const cfg = llmConfig();
  if (!cfg.hasKey) return { filled: {}, source: null, error: 'no API key' };
  const prompt = promptFor(module);
  const dir = cacheDir ?? join(tmpdir(), 'ladder-llm-cache');
  mkdirSync(dir, { recursive: true });
  const key = cachePath(dir, pdfPath, module, prompt);
  let fields;
  if (existsSync(key)) {
    fields = JSON.parse(readFileSync(key, 'utf8'));
  } else {
    const img = pngOf(pdfPath, 200);
    if (!img) return { filled: {}, source: null, error: 'pdftocairo not available for vision' };
    const { text } = await callLLM({ system: SYSTEM, text: prompt, image: img });
    fields = parseJSON(text)?.fields ?? parseJSON(text) ?? {};
    writeFileSync(key, JSON.stringify(fields));
  }
  const filled = {};
  for (const f of blanks) if (fields[f] != null && fields[f] !== '') filled[f] = fields[f];
  return { filled, source: cfg.provider };
}

// --- orchestrator -----------------------------------------------------------
export async function extractParams(pdfPath, { llm = 'auto', cacheDir } = {}) {
  if (!hasPoppler()) throw new Error('pdftotext not found on PATH (brew/apt install poppler)');
  const text = pdftotext(pdfPath);
  if (text == null) throw new Error(`pdftotext failed: ${basename(pdfPath)}`);

  const stitched = stitchText(text);
  const rules = extractRules(stitched.raw, null);
  const { profile, profileName, fixes } = applyProfile(rules, stitched);
  const module = rules.productType ?? 'cat';

  const params = typeFields(rules);
  const confidence = {};
  const warnings = [...fixes];
  for (const f of FIELDS[module]) {
    confidence[f] = params[f] != null ? { source: 'rules', level: 'high' } : { source: null, level: null };
  }
  for (const f of Object.keys(params)) {
    if (!FIELDS[module].includes(f)) warnings.push(`unmapped field: ${f}=${params[f]}`);
  }

  // ONE vision pass, only for blanks (1B.4/1B.5). Never a second call (1B.6).
  const blanks = FIELDS[module].filter((f) => params[f] == null);
  if (llm !== 'off' && (llm === 'whole' || blanks.length)) {
    const want = llm === 'whole' ? FIELDS[module] : blanks;
    const { filled, source, error } = await visionFill(pdfPath, module, want, { cacheDir });
    if (error) warnings.push(`llm: ${error}`);
    for (const [f, v] of Object.entries(filled)) {
      const typed = TYPERS[f] ? TYPERS[f](v) : v;
      if (llm === 'whole' && params[f] != null && String(params[f]) !== String(typed)) {
        warnings.push(`llm(${source}) disagrees with rules on ${f}: keeping rules value`);
        continue; // rules win whenever they return a value (1B.4)
      }
      params[f] = typed ?? v;
      confidence[f] = { source: `vision:${source}`, level: 'medium' };
    }
  }

  // Validate against core ranges where a mapping exists.
  const core = {};
  for (const [f, coreId] of Object.entries(CORE_MAP[module] ?? {})) {
    if (params[f] == null) continue;
    core[coreId] = params[f];
    const e = rangeError(coreId, params[f]);
    if (e) warnings.push(`${f}: ${e}`);
  }
  for (const f of FIELDS[module]) {
    if (params[f] == null) warnings.push(`missing field: ${f}`);
  }

  const normVals = Object.values(params).filter((v) => v != null).map((v) => String(v).toLowerCase().replace(/[\s,]/g, ''));
  const unmappedText = stitched.lines.filter((l) => {
    const n = l.toLowerCase().replace(/[\s,]/g, '');
    return n.length > 3 && !normVals.some((v) => v && n.includes(v));
  }).slice(0, 40);

  return { file: basename(pdfPath), profile, profileName, module, params, core, confidence, warnings, unmappedText };
}
