// PDF → SVG conversion with the measured fallback chain (PLAN §2a):
//   1. Inkscape  — keeps real text, smaller files, BUT segfaults on some PDFs
//   2. gs repair + Inkscape — Ghostscript rewrite of the PDF often cures the
//      importer crash while keeping the text layer (the `009` fix)
//   2b. pdftocairo -pdf repair + Inkscape — on macOS/Inkscape 1.4.4 the gs
//      rewrite does NOT cure the 009 crash, but a cairo PDF rewrite does,
//      still keeping a text layer (verified 2026-10-08)
//   3. pdftocairo — always works, but outlines the text (no <text> runs)
// `auto` (default) tries them in order. Channel A must always succeed —
// convertPdf either returns { converter } or throws with every attempt's reason.
//
// The backend steps live in `runner` so the chain logic is unit-testable
// without Inkscape/Ghostscript installed.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INK = existsSync(join(process.env.HOME || '', '.local/bin/inkscape'))
  ? join(process.env.HOME, '.local/bin/inkscape')
  : 'inkscape'; // container/VPS: resolve via PATH

const DEFAULT_TIMEOUT = 120_000; // ms — Inkscape hung >300s on rasterize during eval

const lastLines = (buf, n = 2, max = 200) =>
  String(buf || '').trim().split('\n').slice(-n).join(' ').slice(0, max);

/** Real backends. Each throws on failure. gsRepair returns a repaired PDF path or null. */
const realRunner = {
  inkscape(pdf, out, timeout) {
    execFileSync(INK, ['--export-type=svg', `--export-filename=${out}`, pdf], { stdio: 'pipe', timeout });
  },
  pdftocairo(pdf, out, timeout) {
    execFileSync('pdftocairo', ['-svg', pdf, out], { stdio: 'pipe', timeout });
  },
  gsRepair(pdf, timeout) {
    const dir = mkdtempSync(join(tmpdir(), 'ladder-gs-'));
    const fixed = join(dir, 'repaired.pdf');
    execFileSync('gs', ['-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', `-sOutputFile=${fixed}`, pdf],
      { stdio: 'pipe', timeout });
    return existsSync(fixed) && statSync(fixed).size > 500 ? fixed : null;
  },
  cairoRepair(pdf, timeout) {
    const dir = mkdtempSync(join(tmpdir(), 'ladder-cairo-'));
    // pdftocairo does NOT append .pdf to the output name — pass it explicitly
    const fixed = join(dir, 'repaired.pdf');
    execFileSync('pdftocairo', ['-pdf', pdf, fixed], { stdio: 'pipe', timeout });
    return existsSync(fixed) && statSync(fixed).size > 500 ? fixed : null;
  },
};

/** Which converters have their binary on PATH? (for tests + honest errors) */
export function availableConverters(runner = realRunner) {
  const ok = [];
  for (const name of ['inkscape', 'gs', 'pdftocairo']) {
    try {
      execFileSync(name === 'inkscape' ? INK : name, [name === 'inkscape' ? '--version' : name === 'gs' ? '--version' : '-v'],
        { stdio: 'pipe' });
      ok.push(name);
    } catch { /* not installed */ }
  }
  return ok;
}

const outputOK = (out) => { try { return statSync(out).size > 200; } catch { return false; } };

/**
 * Convert `pdfPath` to `outSvg`.
 *   converter: 'auto' | 'inkscape' | 'pdftocairo'  (default 'auto')
 *   timeout:   per-attempt timeout ms (default 120s)
 *   runner:    backend steps (tests inject fakes)
 * Returns { converter, repaired? } naming the backend that produced outSvg.
 */
export function convertPdf(pdfPath, outSvg, { converter = 'auto', timeout = DEFAULT_TIMEOUT, runner = realRunner } = {}) {
  const errors = [];
  const tryInkscape = (src, tag) => {
    runner.inkscape(src, outSvg, timeout);
    if (!outputOK(outSvg)) throw new Error('produced no/empty SVG');
    return tag;
  };

  if (converter === 'inkscape' || converter === 'auto') {
    try {
      return { converter: tryInkscape(pdfPath, 'inkscape') };
    } catch (e) {
      errors.push(describe('inkscape', e, timeout));
    }
  }

  if (converter === 'auto') {
    // The `009` fix: a PDF rewrite frequently cures importer crashes while
    // preserving the text layer; retry Inkscape on the repaired PDF. Two
    // rewriters in order: gs (Linux-verified), then pdftocairo -pdf (the
    // macOS/Inkscape 1.4.4 cure — gs does not fix 009 there).
    const repairHops = [['gsRepair', 'repaired'], ['cairoRepair', 'cairo-repaired']];
    for (const [step, tag] of repairHops) {
      try {
        const fixed = runner[step](pdfPath, timeout);
        if (fixed) {
          try {
            return { converter: tryInkscape(fixed, 'inkscape'), repaired: true };
          } catch (e) {
            errors.push(`inkscape(${tag}): ${describe('', e, timeout).trim()}`);
          }
        } else {
          errors.push(`${step}: repair produced no output`);
        }
      } catch (e) {
        errors.push(describe(step, e, timeout));
      }
    }
  }

  if (converter === 'pdftocairo' || converter === 'auto') {
    try {
      runner.pdftocairo(pdfPath, outSvg, timeout);
      if (!outputOK(outSvg)) throw new Error('produced no/empty SVG');
      return { converter: 'pdftocairo' };
    } catch (e) {
      errors.push(describe('pdftocairo', e, timeout));
    }
  }

  throw new Error(`conversion failed — ${errors.join(' | ')}`);
}

function describe(name, e, timeout) {
  const sig = e.signal ? ` (signal ${e.signal}${e.signal === 'SIGSEGV' ? ' — segfault' : ''})` : '';
  const why = e.code === 'ENOENT' ? `${name} not found on PATH`
    : e.code === 'ETIMEDOUT' ? `timed out after ${timeout / 1000}s`
    : lastLines(e.stderr) || e.message;
  return `${name}${sig}: ${why}`;
}
