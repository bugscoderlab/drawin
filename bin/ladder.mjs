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
  node bin/ladder.mjs scaffold <file.pdf>
  node bin/ladder.mjs editor   <templateDir>
  node bin/ladder.mjs proof    <templateDir>
  node bin/ladder.mjs render   <templateId> [params.json] [-o out.svg]
  node bin/ladder.mjs convert  <file.pdf> -o out.svg [--converter auto|inkscape|pdftocairo]
  node bin/ladder.mjs extract  <file.pdf> [-o params.json] [--llm-whole|--no-llm]
  node bin/ladder.mjs eval     [file.pdf ...] [--with-text] [--json]`);
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
      const { scaffold } = await import('../src/eval/scaffold.mjs');
      const r = scaffold(arg);
      console.log(`scaffolded: ${r.id}`);
      console.log(`  folder   : ${r.dir}`);
      console.log(`  outlines : ${r.outlines} duplicate(s) hidden`);
      console.log(`  proposed : ${r.props.length} binding(s)`);
      for (const p of r.props) console.log(`     ${p.id.padEnd(12)} ${p.mode.padEnd(6)} ${JSON.stringify(p.value)}`);
      console.log(`  editor   : ${r.editor}  (${r.editorMB} MB)`);
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
      process.argv[2] = arg;
      await import('../src/eval/proofBind.mjs');
      break;
    }
    case 'render': {
      const args = process.argv.slice(3);
      const oIdx = args.indexOf('-o');
      const out = oIdx >= 0 ? args[oIdx + 1] : null;
      const pos = args.filter((a, i) => a !== '-o' && args[i - 1] !== '-o');
      const [id, paramsFile] = pos;
      if (!id) { usage(); process.exit(1); }
      const values = paramsFile ? JSON.parse(readFileSync(paramsFile, 'utf8')) : {};
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
      const { convertPdf } = await import('../src/convert/convert.mjs');
      const r = convertPdf(resolve(pdf), resolve(out), { converter: conv });
      console.error(`converted with ${r.converter} -> ${out}`);
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
    default:
      usage();
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
