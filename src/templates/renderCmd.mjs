// `ladder render` logic — render any registry template (L1 real art or L3
// code model) with a value map. Kept separate from bin/ladder.mjs so it is
// directly testable.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRegistry } from './registry.mjs';
import { resolveParams, renderTemplate } from './render.mjs';
import { renderDocument } from '../core/render.mjs';
import { paramsFor } from '../core/modules.mjs';

/** Split a standalone SVG document into { viewBox, width, height, inner }. */
export function splitSvgDocument(doc) {
  const m = String(doc).match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error('not an SVG document');
  const attrs = m[1];
  const pick = (re) => { const x = attrs.match(re); return x ? x[1].trim() : null; };
  const width = pick(/\bwidth="([^"]+)"/);
  const height = pick(/\bheight="([^"]+)"/);
  let viewBox = pick(/\bviewBox="([^"]+)"/);
  if (!viewBox && width && height) viewBox = `0 0 ${width} ${height}`;
  return { viewBox: viewBox ?? '0 0 794 1123', width, height, inner: m[2] };
}

/** Standalone SVG document from inner content. */
export function toDocument(inner, { viewBox, width, height }) {
  const size = width && height ? ` width="${width}" height="${height}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}>${inner}</svg>`;
}

/**
 * Render template `id` with `values` (defaults/sample apply for missing keys).
 * Returns { template, svg, report } — or { template, error } for an invalid
 * L3 model. Throws only on CLI misuse (unknown id) — an unmatched drawing is
 * a matchTemplate concern upstream, never an error here.
 */
export function renderById(templatesDir, id, values = {}) {
  const { templates, errors } = loadRegistry(templatesDir);
  const tpl = templates.find((t) => t.id === id);
  if (!tpl) {
    const names = templates.map((t) => t.id).join(', ');
    throw new Error(`unknown template "${id}" — available: ${names}${errors.length ? ` (${errors.length} template(s) failed to load)` : ''}`);
  }

  if (tpl.kind === 'l3') {
    const r = renderDocument(tpl.module, paramsFor(tpl.module, values));
    if (r.error) return { template: tpl, error: r.error };
    return { template: tpl, svg: r.document, report: [] };
  }

  const doc = readFileSync(join(tpl.dir, tpl.base.svg), 'utf8');
  // Missing keys fall back to each param's own default (resolveParams);
  // the sample preset is a demo for the editor, not the render base.
  const eff = resolveParams(tpl.params, values);
  const { svg, report } = renderTemplate(doc, tpl.bindings, eff);
  const parts = splitSvgDocument(svg);
  return { template: tpl, svg: toDocument(parts.inner, parts), report };
}
