// ladder batch (PLAN 3.1): a folder of PDFs -> a complete, self-describing
// output set. Per PDF: params.json, converted.svg, generated.svg, report.md.
// Plus a folder summary. One bad PDF is reported, never fatal (Channel A rule).
//
// 3.2 (profiles as data) and 3.3 (tuning loop) are properties of the
// existing modules: new vendors are entries in src/extract/profiles.mjs, and
// `ladder eval` + the per-file warnings ARE the tuning loop inputs.

import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import { extractParams } from './extract/extract.mjs';
import { convertPdf } from './convert/convert.mjs';
import { generateFromExtract, checkDimensions } from './pipeline.mjs';

export async function batch(dir, outDir, { llm = 'auto', templatesDir, converter = 'auto' } = {}) {
  mkdirSync(outDir, { recursive: true });
  const pdfs = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  const rows = [];
  let failed = 0;

  for (const name of pdfs) {
    const pdf = join(dir, name);
    const slug = name.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-');
    const row = { file: name, status: 'ok' };
    let extract = null, gen = null, convError = null;

    try {
      extract = await extractParams(pdf, { llm });
    } catch (e) {
      row.status = 'extract-failed';
      row.error = e.message;
    }

    // Channel A: conversion always attempted, independently of extraction.
    try {
      const r = convertPdf(pdf, join(outDir, `${slug}.converted.svg`), { converter });
      row.converter = r.converter;
    } catch (e) {
      convError = e.message;
      row.status = row.status === 'ok' ? 'convert-failed' : row.status;
      row.error = [row.error, convError].filter(Boolean).join(' | ');
    }

    if (extract) {
      writeFileSync(join(outDir, `${slug}.params.json`), JSON.stringify(extract, null, 2) + '\n');
      gen = generateFromExtract(extract, { templatesDir });
      if (gen.svg) {
        writeFileSync(join(outDir, `${slug}.generated.svg`), gen.svg + '\n');
        const { checks } = checkDimensions(extract, gen.svg);
        row.via = gen.via;
        row.dims = `${checks.filter((c) => c.ok).length}/${checks.length}`;
        row.checks = checks;
      } else {
        row.status = 'generate-failed';
        row.error = [row.error, gen.error].filter(Boolean).join(' | ');
      }
      row.module = extract.module;
      row.profile = extract.profile;
      const conf = Object.values(extract.confidence ?? {});
      row.fields = `${conf.filter((c) => c.source === 'rules').length} rules + ${conf.filter((c) => c.source?.startsWith('vision')).length} vision`;
      row.warnings = extract.warnings.length;
      writeFileSync(join(outDir, `${slug}.report.md`), fileReport(name, extract, gen, row, convError));
    }

    if (row.status !== 'ok') failed++;
    rows.push(row);
  }

  const summary = summaryReport(rows);
  writeFileSync(join(outDir, 'report.md'), summary);
  return { files: pdfs.length, ok: pdfs.length - failed, failed, rows, summaryPath: join(outDir, 'report.md') };
}

function fileReport(name, extract, gen, row, convError) {
  const lines = [
    `# ${name}`, '',
    `- module: **${extract.module}**  (profile: ${extract.profileName})`,
    `- generated via: ${gen?.via ?? '—'}`,
    `- dimensions present in drawing: ${row.dims ?? '—'}`,
    ``,
    `## params`, '',
    '```json', JSON.stringify(extract.params, null, 2), '```', '',
    `## confidence`, '',
    ...Object.entries(extract.confidence).map(([f, c]) => `- ${f}: ${c.source ?? '—'}${c.level ? ` (${c.level})` : ''}`),
    '',
    `## warnings (${extract.warnings.length})`, '',
    ...extract.warnings.map((w) => `- ${w}`),
  ];
  if (convError) lines.push('', `## conversion`, '', `- ${convError}`);
  return lines.join('\n') + '\n';
}

function summaryReport(rows) {
  const lines = [
    '# Batch summary', '',
    `| file | status | module | profile | via | fields | dims | warnings |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.file} | ${r.status} | ${r.module ?? '—'} | ${r.profile ?? '—'} | ${r.via ?? '—'} | ${r.fields ?? '—'} | ${r.dims ?? '—'} | ${r.warnings ?? '—'} |`),
    '',
    `**${rows.filter((r) => r.status === 'ok').length}/${rows.length} ok**`,
  ];
  const bad = rows.filter((r) => r.status !== 'ok');
  if (bad.length) {
    lines.push('', '## failures', '');
    for (const r of bad) lines.push(`- ${r.file}: ${r.status} — ${r.error}`);
  }
  return lines.join('\n') + '\n';
}
