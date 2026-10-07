// Shared PDF helpers for the eval/probe tools. Shells out to poppler.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

export function pdftotext(file) {
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
}

export function pagePng(file, dpi = 150) {
  const dir = mkdtempSync(join(tmpdir(), 'ladder-'));
  const out = join(dir, 'page');
  execFileSync('pdftocairo', ['-png', '-r', String(dpi), '-singlefile', file, out]);
  const buf = readFileSync(out + '.png');
  return { base64: buf.toString('base64'), mimeType: 'image/png', bytes: buf.length };
}

export function inferModule(file) {
  const f = basename(file);
  return /2607-003|RHC/.test(f) ? 'trolley' : /2607-004/.test(f) ? 'cage' : /2609-007/.test(f) ? 'cat' : null;
}
