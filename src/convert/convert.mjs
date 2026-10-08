// PDF → SVG conversion with the measured fallback chain (PLAN §2a):
//   1. Inkscape  — keeps real text, smaller files, BUT segfaults on some PDFs
//   2. pdftocairo — always works, but outlines the text (no <text> runs)
// `auto` (default) tries Inkscape with a timeout and falls back on any failure.
// Channel A must always succeed — convertPdf either returns { converter } or
// throws with every attempt's reason.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape'; // container/VPS: resolve via PATH

const DEFAULT_TIMEOUT = 120_000; // ms — Inkscape hung >300s on rasterize during eval

const lastLines = (buf, n = 2, max = 200) =>
  String(buf || '').trim().split('\n').slice(-n).join(' ').slice(0, max);

function runInkscape(pdf, out, timeout) {
  execFileSync(INK, ['--export-type=svg', `--export-filename=${out}`, pdf], { stdio: 'pipe', timeout });
}

function runPdftocairo(pdf, out, timeout) {
  execFileSync('pdftocairo', ['-svg', pdf, out], { stdio: 'pipe', timeout });
}

const BACKENDS = {
  inkscape: { run: runInkscape, label: 'Inkscape' },
  pdftocairo: { run: runPdftocairo, label: 'pdftocairo' },
};

/** Which backends have their binary on PATH? (for tests + honest error messages) */
export function availableConverters() {
  const ok = [];
  for (const [name, b] of Object.entries(BACKENDS)) {
    try {
      execFileSync(name === 'inkscape' ? INK : name, [name === 'inkscape' ? '--version' : '-v'], { stdio: 'pipe' });
      ok.push(name);
    } catch { /* not installed */ }
  }
  return ok;
}

/**
 * Convert `pdfPath` to `outSvg`.
 * opts.converter: 'auto' | 'inkscape' | 'pdftocairo'  (default 'auto')
 * opts.timeout:   per-attempt timeout ms (default 120s)
 * Returns { converter } naming the backend that produced outSvg.
 */
export function convertPdf(pdfPath, outSvg, { converter = 'auto', timeout = DEFAULT_TIMEOUT } = {}) {
  const order = converter === 'auto' ? ['inkscape', 'pdftocairo']
    : converter === 'inkscape' ? ['inkscape']
    : ['pdftocairo'];
  const errors = [];
  for (const name of order) {
    const backend = BACKENDS[name];
    try {
      backend.run(pdfPath, outSvg, timeout);
      if (existsSync(outSvg) && backendWorked(outSvg)) return { converter: name };
      errors.push(`${name}: produced no/empty SVG`);
    } catch (e) {
      const sig = e.signal ? ` (signal ${e.signal}${e.signal === 'SIGSEGV' ? ' — segfault' : ''})` : '';
      const why = e.code === 'ENOENT' ? `${name} not found on PATH`
        : e.code === 'ETIMEDOUT' ? `timed out after ${timeout / 1000}s`
        : lastLines(e.stderr) || e.message;
      errors.push(`${name}${sig}: ${why}`);
    }
  }
  throw new Error(`conversion failed — ${errors.join(' | ')}`);
}

/** Inkscape can exit 0 yet write nothing on some inputs; guard against empty output. */
function backendWorked(outSvg) {
  try { return statSync(outSvg).size > 200; } catch { return false; }
}
