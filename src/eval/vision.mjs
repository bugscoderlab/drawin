// Vision dimension recovery (docs/plans/vision-dimension-recovery.md).
//
// Some PDFs carry dimension annotations as vector outlines only — the text
// layer yields zero dimension params (known case: LSB-2609-007-FHL-R00.pdf).
// This pass asks a vision model for each dim's {value, x_pct, y_pct}, locates
// the outline glyph cluster nearest the converted position, and REPLACES the
// cluster with a real <text> node (position/size from the cluster bbox), so
// text binding and proposeGeometry run completely unchanged. A dim whose
// px/mm fails the plausibility gate is dropped by the caller and reported —
// never silent.
//
//   const rec = await recoverVisionDims({ file, rows, svg, pageW, pageH, call });
//   // -> { svg, dims: [{ value, x, y, id, vertical }] } | null (disabled/no dims)
//
// opts.call injects a fake LLM ({ system, text, image }) -> { text } (tests);
// without a call and without a key the pass is a quiet no-op.

import { readFileSync, writeFileSync } from 'node:fs';
import { callLLM, parseJSON } from '../extract/llm.js';
import { llmConfig } from '../config/env.mjs';
import { hideIds } from '../templates/authoring.mjs';
import { pagePng } from './pdf.mjs';

const GLYPH_MAX = 14;      // outline glyph paths are tiny …
const GLYPH_ASPECT = 2.9;  // … and compact; dim-line/arrow stubs are long-thin
const NEAR_R = 30;         // vision text centres are accurate to a few px
const GAP = 3;             // max gap between adjacent glyphs of one number
const SPAN_MAX = 70;       // one number's cluster stays compact
const DIM_VALUE = /^\d{3,6}(\.\d{1,2})?$/;   // what the dim tokenizer can bind

/** Glyph-like outline paths: tiny AND not long-thin (excludes line/arrow stubs). */
const glyphish = (r) => r.id.startsWith('path') && r.w > 0 && r.h > 0
  && Math.max(r.w, r.h) <= GLYPH_MAX && Math.max(r.w, r.h) / Math.min(r.w, r.h) <= GLYPH_ASPECT;

/** Round to 1 decimal — synthesized coordinates come from bboxes, not sub-px. */
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Outline glyph cluster nearest (cx, cy): the closest glyph path seeds a
 * cluster that grows by adjacency (other paths may sit nearby but only the
 * connected group joins). Returns { ids, bbox } or null when nothing is near.
 */
export function findOutlineCluster(rows, cx, cy) {
  const near = rows.filter(glyphish)
    .filter((r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) <= NEAR_R)
    .sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy));
  if (!near.length) return null;
  const cl = [near[0]];
  let grew = true;
  while (grew) {
    grew = false;
    const bx = bbox(cl);
    if (bx.x1 - bx.x0 > SPAN_MAX || bx.y1 - bx.y0 > SPAN_MAX) break;
    for (const o of near) {
      if (cl.includes(o)) continue;
      const gap = Math.max(bx.x0 - (o.x + o.w), o.x - bx.x1, bx.y0 - (o.y + o.h), o.y - bx.y1);
      if (gap <= GAP) { cl.push(o); grew = true; }
    }
  }
  return { ids: cl.map((r) => r.id), bbox: bbox(cl) };
}

const bbox = (paths) => ({
  x0: Math.min(...paths.map((p) => p.x)),
  y0: Math.min(...paths.map((p) => p.y)),
  x1: Math.max(...paths.map((p) => p.x + p.w)),
  y1: Math.max(...paths.map((p) => p.y + p.h)),
});

/**
 * Replace the cluster with a synthesized <text> node — Arial, position and
 * size from the cluster bbox; rotated bottom-to-top when the cluster is tall
 * (vertical dimensions read that way on these drawings). The earliest cluster
 * element in document order is replaced in place (z-order kept); the rest are
 * removed. Returns { svg, id, vertical } or null when the cluster is missing.
 */
export function synthesizeDimText(svg, cluster, value, id) {
  if (!cluster?.ids?.length) return null;
  const { ids } = cluster;
  const bx = cluster.bbox;
  const bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0;
  const vertical = bh > bw;
  const fs = Math.max(4, r1((vertical ? bw : bh) / 0.72));  // bbox ≈ cap height
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Document order: the cluster element that appears first is the anchor.
  let firstAt = -1, firstId = null, firstHtml = null;
  for (const cid of ids) {
    const m = svg.match(new RegExp(`<[a-zA-Z]+\\b[^>]*\\bid="${esc(cid)}"[^>]*/>`))
      ?? svg.match(new RegExp(`<[a-zA-Z]+\\b[^>]*\\bid="${esc(cid)}"[^>]*>[\\s\\S]*?</[a-zA-Z]+>`));
    if (m && (firstAt === -1 || m.index < firstAt)) { firstAt = m.index; firstId = cid; firstHtml = m[0]; }
  }
  if (firstHtml === null) return null;

  const text = vertical
    ? `<text id="${id}" transform="matrix(0,-1,1,0,${r1((bx.x0 + bx.x1) / 2)},${r1((bx.y0 + bx.y1) / 2)})" font-family="Arial" font-size="${fs}">${value}</text>`
    : `<text id="${id}" x="${r1(bx.x0)}" y="${r1(bx.y1)}" font-family="Arial" font-size="${fs}">${value}</text>`;
  return { svg: hideIds(svg.replace(firstHtml, text), ids.filter((c) => c !== firstId)), id, vertical };
}

/**
 * Zero-dims vision recovery. One image call per scaffold; every well-formed,
 * locatable dim is synthesized into the SVG as a real <text> node. The caller
 * (scaffold) runs the px/mm plausibility gate and reports rejections.
 *
 * `image` may be injected (tests) — otherwise the page PNG is rendered from
 * `file`. Returns { svg, dims } or null (LLM disabled, nothing proposed, or
 * any failure — never throws).
 *
 * `cache` ({ path, hash }) stores the raw LLM reply in vision.json beside the
 * emitted template, keyed by a content hash of the source PDF (issue #5): a
 * matching hash replays the cached reply without a new vision call; a
 * missing/corrupt/mismatched cache degrades to a fresh call, never a failure.
 */
export async function recoverVisionDims({ file, image, rows, svg, pageW, pageH, timeoutMs = 30000, call, cache } = {}) {
  if (!call && !llmConfig().hasKey) return null;
  const system = 'You read dimension annotations on aluminium ladder / scaffolding shop drawings.';
  const text = `This engineering drawing's dimension annotations are vector outlines (no text layer). List every dimension annotation you can see: a bare number in mm (integer or with up to 2 decimals), centred on its dimension line with arrowheads. Ignore part-number balloons/callouts, title block fields, and notes.
Return JSON: {"dims":[{"value":<number>,"x_pct":<0-1>,"y_pct":<0-1>}, ...]} where x_pct/y_pct are the centre of the dimension TEXT, normalized to the page image (left origin, top origin).`;
  try {
    let reply = null;
    if (cache?.path && cache?.hash) {
      try {
        const c = JSON.parse(readFileSync(cache.path, 'utf8'));
        if (c?.hash === cache.hash && typeof c?.reply === 'string') reply = c.reply;
      } catch { /* missing/corrupt cache -> fresh call below */ }
    }
    if (reply === null) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const doCall = call || callLLM;
      ({ text: reply } = await doCall({ system, text, image: image || pagePng(file), json: true, maxTokens: 2000, temperature: 0, signal: ctrl.signal }));
      clearTimeout(t);
      if (cache?.path) {
        try { writeFileSync(cache.path, JSON.stringify({ hash: cache.hash, reply }) + '\n'); } catch { /* cache is best-effort */ }
      }
    }
    const j = parseJSON(reply);
    const out = { svg, dims: [] };
    const seen = new Set();
    let n = 0;
    for (const d of j?.dims || []) {
      const value = String(d?.value ?? '').replace(/,/g, '').trim();
      const xp = Number(d?.x_pct), yp = Number(d?.y_pct);
      if (!DIM_VALUE.test(value) || seen.has(value)) continue;
      if (!Number.isFinite(xp) || !Number.isFinite(yp) || xp < 0 || xp > 1 || yp < 0 || yp > 1) continue;
      const cluster = findOutlineCluster(rows, xp * pageW, yp * pageH);
      if (!cluster) continue;
      const synth = synthesizeDimText(out.svg, cluster, value, `vision${++n}`);
      if (!synth) continue;
      seen.add(value);
      out.svg = synth.svg;
      out.dims.push({
        value, id: synth.id, vertical: synth.vertical,
        x: xp * pageW, y: yp * pageH,
        clusterIds: cluster.ids, bbox: cluster.bbox,
      });
    }
    return out.dims.length ? out : null;
  } catch {
    return null;
  }
}
