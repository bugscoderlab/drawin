// Poppler text-layer access for extraction. CLI-only (native binary).

import { execFileSync } from 'node:child_process';

/** `pdftotext -layout` output, or null when poppler is not installed. */
export function pdftotext(file) {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** True when the pdftotext binary is available. */
export function hasPoppler() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}
