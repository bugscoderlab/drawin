// Build a self-contained editor/preview HTML for a template.
//   node src/eval/makeEditor.mjs templates/cage-fhl
// writes preview/<id>-editor.html (base art + params + binding engine inlined).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The shell ships with the code — resolve it from this module, not the process cwd.
const SHELL = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'editor.template.html');

export function buildEditor(tplDir = 'templates/trolley-slt', { previewDir } = {}) {
  const dir = resolve(tplDir);
  const tpl = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8'));
  const svgPath = join(dir, tpl.base?.svg || 'base.clean.svg');
  if (!existsSync(svgPath)) throw new Error(`missing ${svgPath} — run the scaffold/proof first to produce the cleaned base`);
  const svg = readFileSync(svgPath, 'utf8');

  const shell = readFileSync(SHELL, 'utf8');
  const html = shell
    .replace('__ID__', tpl.id)
    .replace('__TEMPLATE_JSON__', () => JSON.stringify(tpl))
    .replace('__BASE_SVG__', () => svg);

  const dest = resolve(previewDir || 'preview');
  mkdirSync(dest, { recursive: true });
  const out = join(dest, `${tpl.id}-editor.html`);
  writeFileSync(out, html);
  return { out, bytes: html.length, id: tpl.id };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildEditor(process.argv[2]);
  console.log(`wrote ${r.out}  (${(r.bytes / 1e6).toFixed(1)} MB)`);
}
