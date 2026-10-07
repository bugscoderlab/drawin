#!/usr/bin/env node
// Laddertech drawing CLI.
//
//   node bin/ladder.mjs serve              local upload -> scaffold -> editor server
//
import { resolve } from 'node:path';

const [cmd, arg] = process.argv.slice(2);

const usage = () => {
  console.log(`usage:
  node bin/ladder.mjs serve [port]
  node bin/ladder.mjs scaffold <file.pdf>
  node bin/ladder.mjs editor   <templateDir>
  node bin/ladder.mjs proof    <templateDir>`);
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
    default:
      usage();
  }
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
