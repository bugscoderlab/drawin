#!/usr/bin/env node
// Laddertech drawing CLI.
//
//   node bin/ladder.mjs serve              local upload -> scaffold -> editor server
//
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);

const usage = () => {
  console.log(`usage:
  node bin/ladder.mjs serve [port]
  node bin/ladder.mjs scaffold <file.pdf> [--force]
  node bin/ladder.mjs editor   <templateDir>
  node bin/ladder.mjs proof    <templateDir> [--set param=value ...]
  node bin/ladder.mjs render   <templateId> [params.json] [-o out.svg]
  node bin/ladder.mjs convert  <file.pdf> -o out.svg [--converter auto|inkscape|pdftocairo]
  node bin/ladder.mjs extract  <file.pdf> [-o params.json] [--llm-whole|--no-llm]
  node bin/ladder.mjs eval     [file.pdf ...] [--with-text] [--json]
  node bin/ladder.mjs generate <params.json> [-o drawing.svg]
  node bin/ladder.mjs verify   <file.pdf> [--no-llm] [--strict]
  node bin/ladder.mjs batch    <dir> --out <dir> [--no-llm]`);
};

try {
  switch (cmd) {
    case 'serve': {
      const { serve } = await import('../src/serve.mjs');
      serve(Number(arg) || 8123);
      break;
    }
    case 'scaffold': {
      if (!arg) { usage(); process.exit(1); }
      const { scaffold, reportScaffold } = await import('../src/eval/scaffold.mjs');
      const r = await scaffold(arg, { force: process.argv.slice(3).includes('--force') });
      reportScaffold(r);
      break;
    }
    case 'editor': {
      if (!arg) { usage(); process.exit(1); }
      const { buildEditor } = await import('../src/eval/makeEditor.mjs');
      const r = buildEditor(arg);
      console.log(`wrote ${r.out}  (${(r.bytes / 1e6).toFixed(1)} MB)`);
      break;
    }
    case 'proof': {
      if (!arg) { usage(); process.exit(1); }
      const { runProof, parseOverrides } = await import('../src/eval/proofBind.mjs');
      runProof(arg, parseOverrides(process.argv.slice(4)));
      break;
    }
    case 'render': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('-o');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const pos = args.filter((a, i) => a !== '-o' && args[i - 1] !== '-o');
      const [id, paramsFile] = pos;
      if (!id) { usage(); process.exit(1); }
      const values = paramsFile
        ? (paramsFile.trim().startsWith('{') ? JSON.parse(paramsFile) : JSON.parse(readFileSync(paramsFile, 'utf8')))
        : {};
      const { renderById } = await import('../src/templates/renderCmd.mjs');
      const r = renderById(resolve('templates'), id, values);
      if (r.error) throw new Error(r.error);
      const misses = r.report.filter((x) => !x.ok);
      if (out) writeFileSync(out, r.svg + '\n');
      else console.log(r.svg);
      console.error(`rendered ${id}: ${r.report.length - misses.length}/${r.report.length} bindings ok`
        + (misses.length ? ` — MISSED: ${misses.map((m) => `${m.param} (${m.reason})`).join(', ')}` : ''));
      break;
    }
    case 'convert': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('-o');
      const cIdx = args.indexOf('--converter');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const conv = cIdx >= 0 ? args[cIdx + 1] : 'auto';
      const [pdf] = args.filter((a, i) => a !== '-o' && args[i - 1] !== '-o' && a !== '--converter' && args[i - 1] !== '--converter');
      if (!pdf || !out) { usage(); process.exit(1); }
      const { convertPdf, formatHops } = await import('../src/convert/convert.mjs');
      try {
        const r = convertPdf(resolve(pdf), resolve(out), { converter: conv });
        console.error(formatHops(r.hops));
        console.error(`converted with ${r.converter}${r.repaired ? ' (repaired)' : ''} -> ${out}`);
      } catch (e) {
        if (e.hops) console.error(formatHops(e.hops)); // fallback is never silent
        throw e;
      }
      break;
    }
    case 'extract': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('-o');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const llm = args.includes('--llm-whole') ? 'whole' : args.includes('--no-llm') ? 'off' : 'auto';
      const [pdf] = args.filter((a, i) => !['-o', '--llm-whole', '--no-llm'].includes(a) && args[i - 1] !== '-o');
      if (!pdf) { usage(); process.exit(1); }
      const { extractParams } = await import('../src/extract/extract.mjs');
      const r = await extractParams(resolve(pdf), { llm });
      const json = JSON.stringify(r, null, 2) + '\n';
      if (out) writeFileSync(out, json); else console.log(json);
      const filled = Object.values(r.confidence).filter((c) => c.source?.startsWith('vision')).length;
      const rules = Object.values(r.confidence).filter((c) => c.source === 'rules').length;
      console.error(`extracted ${r.file}: module=${r.module} profile=${r.profile} fields ${rules} rules + ${filled} vision-filled, ${r.warnings.length} warning(s)`);
      break;
    }
    case 'eval': {
      const args = process.argv.slice(3);
      const asJson = args.includes('--json');
      const withText = args.includes('--with-text');
      const files = args.filter((a) => !a.startsWith('--'));
      const { scoreFiles, resolveCorpus } = await import('../src/eval/scoreboard.mjs');
      const list = files.length ? files.map((f) => resolve(f)) : resolveCorpus(resolve('.'));
      if (!list.length) throw new Error('no PDFs found (pass files or run from the repo root)');
      const r = await scoreFiles(list, { text: withText, vision: true });
      if (asJson) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`llm: ${r.key ?? 'NO KEY — rules-only'}`);
        for (const [method, [hit, n]] of Object.entries(r.totals)) {
          console.log(`  ${method.padEnd(8)} ${hit}/${n} (${Math.round((hit / n) * 100)}%)`);
        }
        for (const res of r.results) {
          const misses = res.rows.filter((x) => x.cells.merged !== 'hit');
          console.log(`${res.file} [${res.module}]: ${res.rows.length - misses.length}/${res.rows.length} merged`
            + (misses.length ? ` — missed: ${misses.map((x) => x.field).join(', ')}` : ''));
        }
      }
      break;
    }
    case 'generate': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('-o');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const [paramsFile] = args.filter((a, i) => a !== '-o' && args[i - 1] !== '-o');
      if (!paramsFile) { usage(); process.exit(1); }
      const { generateFromExtract } = await import('../src/pipeline.mjs');
      const extract = JSON.parse(readFileSync(resolve(paramsFile), 'utf8'));
      const g = generateFromExtract(extract, { templatesDir: resolve('templates') });
      if (g.error) throw new Error(g.error);
      if (out) writeFileSync(out, g.svg + '\n'); else console.log(g.svg);
      console.error(`generated via ${g.via}${g.bound?.length ? ` — bound: ${g.bound.join(', ')}` : ''}${g.unbound?.length ? ` — defaults: ${g.unbound.join(', ')}` : ''}`);
      break;
    }
    case 'verify': {
      const args = process.argv.slice(3);
      const strict = args.includes('--strict');
      const noLlm = args.includes('--no-llm');
      const [pdf] = args.filter((a) => !a.startsWith('--'));
      if (!pdf) { usage(); process.exit(1); }
      const { verifyPdf } = await import('../src/pipeline.mjs');
      const r = await verifyPdf(resolve(pdf), { llm: noLlm ? 'off' : 'auto', templatesDir: resolve('templates') });
      console.log(`verify ${r.extract.file}: module=${r.extract.module} via=${r.via} — dimensions ${r.ok}/${r.total} present in the generated drawing`);
      for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.field} = ${c.value}${c.where ? `  (${c.where})` : c.reason ? `  (${c.reason})` : ''}`);
      if (r.skipped.length) console.log(`  skipped (non-dimension): ${r.skipped.join(', ')}`);
      if (r.extract.warnings.length) console.log(`  warnings: ${r.extract.warnings.join('; ')}`);
      if (strict && r.ok < r.total) process.exit(1);
      break;
    }
    case 'batch': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('--out');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const noLlm = args.includes('--no-llm');
      const [dir] = args.filter((a, i) => a !== '--out' && args[i - 1] !== '--out' && !a.startsWith('--'));
      if (!dir || !out) { usage(); process.exit(1); }
      const { batch } = await import('../src/batch.mjs');
      const r = await batch(resolve(dir), resolve(out), { llm: noLlm ? 'off' : 'auto', templatesDir: resolve('templates') });
      console.log(`batch: ${r.ok}/${r.files} ok${r.failed ? `, ${r.failed} FAILED` : ''} — ${r.summaryPath}`);
      for (const row of r.rows) {
        console.log(`  ${row.status === 'ok' ? '✓' : '✗'} ${row.file}${row.module ? ` [${row.module}/${row.profile}]` : ''}${row.dims ? ` dims ${row.dims}` : ''}${row.status !== 'ok' ? ` — ${row.error}` : ''}`);
      }
      if (r.failed) process.exitCode = 1;
      break;
    }
    default:
      usage();
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
