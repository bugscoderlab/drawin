// Local backend bridge: upload a PDF in the browser and the server does the work.
//   node bin/ladder.mjs serve [port]
//
//   GET  /               upload page (lists existing templates)
//   POST /scaffold       body = PDF bytes, header x-filename → runs scaffold, returns JSON
//   GET  /editor/<id>    serves the generated editor HTML
//   GET  /pdf/<id>       serves the source PDF for reference
//
// Conversion is native (Inkscape), which is exactly why this must be a local server.

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffold } from './eval/scaffold.mjs';
import { buildEditor } from './eval/makeEditor.mjs';
import { svgIds } from './templates/authoring.mjs';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ladder drawing — upload</title>
<style>
 :root{--navy:#17314d;--orange:#f58220;--line:#cad4dd;--muted:#657484;--bg:#edf1f4}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:#17283a;font:15px/1.45 Arial,Helvetica,sans-serif}
 header{background:var(--navy);color:#fff;padding:14px 20px;font-weight:700}
 main{max-width:1100px;margin:22px auto;padding:0 16px}
 .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}
 .drop{border:2px dashed #b9c6d1;border-radius:12px;padding:30px;text-align:center;color:var(--muted);background:#fbfdff}
 .drop.on{border-color:var(--orange);background:#fff8f0;color:var(--navy)}
 button{border:0;border-radius:8px;min-height:42px;padding:10px 16px;font-weight:700;cursor:pointer;background:var(--orange);color:#fff}
 button:disabled{opacity:.5;cursor:not-allowed}
 .muted{color:var(--muted);font-size:.85rem}
 .err{background:#fff0ed;border:1px solid #e7b5ae;color:#a12417;border-radius:8px;padding:11px 12px;margin-top:12px;white-space:pre-wrap}
 table{width:100%;border-collapse:collapse} td,th{text-align:left;padding:7px 6px;border-bottom:1px solid #eef2f5;font-size:.9rem}
 a{color:var(--navy)} .pill{background:#e7f6ec;color:#1a6535;border-radius:999px;padding:1px 8px;font-size:.72rem;font-weight:700}
 .spin{display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px;margin-right:8px}
 @keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<header>Laddertech — upload a PDF</header>
<main>
  <div class="card">
    <div class="drop" id="drop">
      <div style="font-size:1.05rem;font-weight:700;color:#17314d">Drop a PDF here, or click to choose</div>
      <div class="muted" style="margin-top:6px">The server converts it, hides duplicate outlines, proposes bindings, and builds a live editor.</div>
      <input type="file" id="file" accept="application/pdf" style="display:none">
    </div>
    <div style="margin-top:12px"><button id="go" disabled>Scaffold</button> <span class="muted" id="picked"></span></div>
    <div class="err" id="err" style="display:none"></div>
  </div>
  <div class="card" id="result" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <b id="rtitle"></b><a id="ropen" target="_blank">open in new tab ↗</a>
    </div>
    <div id="rprops" class="muted" style="margin-bottom:10px"></div>
    <iframe id="rframe" style="width:100%;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>
  </div>
  <div class="card">
    <b>Existing templates</b>
    <table id="list"></table>
  </div>
</main>
<script>
 const fileEl=document.getElementById('file'), drop=document.getElementById('drop'), go=document.getElementById('go'), picked=document.getElementById('picked');
 let f=null;
 let uploadToken=localStorage.getItem('drawin_upload_token')||'';
 const setFile=(x)=>{ f=x; picked.textContent=x?x.name+'  ('+(x.size/1e6).toFixed(1)+' MB)':''; go.disabled=!x; };
 drop.onclick=()=>fileEl.click();
 fileEl.onchange=()=>setFile(fileEl.files[0]);
 ['dragover','dragenter'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('on')}));
 ['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('on')}));
 drop.addEventListener('drop',ev=>{ if(ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]); });

 go.onclick=async()=>{
   if(!f) return;
   const err=document.getElementById('err'); err.style.display='none';
   go.disabled=true; go.innerHTML='<span class="spin"></span>Scaffolding… (10–30 s)';
   try{
     const r=await fetch('/scaffold',{method:'POST',headers:{'x-filename':f.name,'x-upload-token':uploadToken},body:f});
     const j=await r.json();
     if(r.status===401 || (j.error||'').toLowerCase().includes('unauthorized')){ uploadToken=prompt('Upload token required:')||''; localStorage.setItem('drawin_upload_token',uploadToken); throw new Error('token saved — hit Scaffold again'); }
     if(!j.ok) throw new Error(j.error||'failed');
     document.getElementById('rtitle').textContent=j.name+'  ('+j.id+')';
     document.getElementById('ropen').href=j.editor;
     document.getElementById('rprops').textContent='proposed: '+j.props.map(p=>p.id+'='+p.value).join('  ·  ');
     const frame=document.getElementById('rframe');
     let ro=null;
     const fit=()=>{ try{ const d=frame.contentDocument; if(!d||!d.body) return; frame.style.height=(d.body.scrollHeight+24)+'px'; if(!ro&&window.ResizeObserver){ ro=new ResizeObserver(()=>{frame.style.height=(d.body.scrollHeight+24)+'px';}); ro.observe(d.body);} }catch(_){} };
     frame.onload=()=>{ fit(); setTimeout(fit,150); setTimeout(fit,600); };
     frame.src=j.editor;
     document.getElementById('result').style.display='block';
     loadList();
   }catch(e){ err.textContent='Error: '+e.message; err.style.display='block'; }
   finally{ go.disabled=false; go.textContent='Scaffold'; }
 };
 async function loadList(){
   const t=await (await fetch('/templates')).json();
   document.getElementById('list').innerHTML='<tr><th>id</th><th>name</th><th></th></tr>'+t.map(x=>
     '<tr><td>'+x.id+'</td><td>'+x.name+'</td><td>'+(x.editor?'<a href="/editor/'+x.id+'" target="_blank">editor ↗</a>':'—')+'</td></tr>').join('');
 }
 (async()=>{ try{ const c=await (await fetch('/config')).json(); if(c.tokenRequired && !uploadToken){ uploadToken=prompt('This server requires an upload token:')||''; localStorage.setItem('drawin_upload_token',uploadToken);} }catch(_){} })();
 loadList();
</script></body></html>`;

const readBody = (req) => new Promise((res, rej) => {
  const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej);
});
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Optional hardening for a public host: set UPLOAD_TOKEN and send it as the
// x-upload-token header on POST /scaffold and POST /bind. Open when unset.
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';
const tokenOk = (req) => !UPLOAD_TOKEN || req.headers['x-upload-token'] === UPLOAD_TOKEN;

// Everything the server reads or writes is pinned to the server's own installed
// location (this file's src/), never to the process cwd — `serve` started from
// any directory must scaffold into this repo's templates/. DRAWIN_ROOT exists so
// the HTTP tests can point a spawned server at temp dirs.
const ROOT = process.env.DRAWIN_ROOT
  ? resolve(process.env.DRAWIN_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'templates');
const PREVIEW = join(ROOT, 'preview');

// Localhost by default; HOST (e.g. 0.0.0.0) is the explicit choice for LAN exposure.
const HOST = process.env.HOST || '127.0.0.1';

function listTemplates() {
  const dir = TEMPLATES;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const id of readdirSync(dir)) {
    const tp = join(dir, id, 'template.json');
    if (!existsSync(tp)) continue;
    const t = JSON.parse(readFileSync(tp, 'utf8'));
    out.push({ id, name: t.name || id, editor: existsSync(join(PREVIEW, `${id}-editor.html`)) });
  }
  return out;
}

export function serve(port = 8123) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html', PAGE);

      if (req.method === 'GET' && url.pathname === '/templates')
        return send(res, 200, 'application/json', JSON.stringify(listTemplates()));

      if (req.method === 'GET' && url.pathname === '/config')
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, tokenRequired: !!UPLOAD_TOKEN }));

      if (req.method === 'POST' && url.pathname === '/scaffold') {
        if (!tokenOk(req)) return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'unauthorized (x-upload-token)' }));
        const buf = await readBody(req);
        if (!buf.length) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'empty upload' }));
        const name = String(req.headers['x-filename'] || 'upload.pdf').replace(/[^\w.\- ]/g, '_');
        const id = slug(name.replace(/\.pdf$/i, '')) || `upload-${Date.now()}`;
        const tmp = join(tmpdir(), `ladder-upload-${Date.now()}-${name}`);
        writeFileSync(tmp, buf);
        const r = await scaffold(tmp, { id, sourceName: name, templatesDir: TEMPLATES, previewDir: PREVIEW });
        return send(res, 200, 'application/json', JSON.stringify({
          ok: true, id: r.id,
          name: r.props.find((p) => p.id === 'productName')?.value || r.id,
          props: r.props.map((p) => ({ id: p.id, label: p.label, mode: p.mode, value: p.value })),
          editor: `/editor/${r.id}`,
        }));
      }

      if (req.method === 'POST' && url.pathname === '/bind') {
        if (!tokenOk(req)) return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'unauthorized (x-upload-token)' }));
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const id = slug(body.id || '');
        const tp = join(TEMPLATES, id, 'template.json');
        if (!existsSync(tp)) return send(res, 404, 'application/json', JSON.stringify({ ok: false, error: 'unknown template' }));
        const t = JSON.parse(readFileSync(tp, 'utf8'));
        // An id binding must anchor to nodes that exist in the template's base
        // art — reject unknown ids instead of writing them into template.json.
        if (body.ids && body.ids.length) {
          const svgFile = join(TEMPLATES, id, t.base?.svg || 'base.clean.svg');
          if (!existsSync(svgFile)) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'no base art to validate against' }));
          const known = svgIds(readFileSync(svgFile, 'utf8'));
          const missing = body.ids.filter((x) => !known.has(String(x)));
          if (missing.length) return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: `id(s) not in base art: ${missing.join(', ')}` }));
        }
        if (!t.params.some((p) => p.id === body.param)) t.params.push({ id: body.param, label: body.label || body.param, type: 'text', default: body.value });
        const binding = body.ids && body.ids.length
          ? { ids: body.ids, param: body.param, mode: 'id' }
          : { value: body.value, param: body.param, mode: body.mode || 'text' };
        if (!t.bindings.some((b) => b.param === body.param)) t.bindings.push(binding);
        writeFileSync(tp, JSON.stringify(t, null, 2) + '\n');
        buildEditor(join(TEMPLATES, id), { previewDir: PREVIEW });
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, id, param: body.param, value: body.value, mode: body.mode }));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/editor/')) {
        const id = slug(url.pathname.split('/')[2] || '');
        const f = join(PREVIEW, `${id}-editor.html`);
        if (!existsSync(f)) return send(res, 404, 'text/plain', 'no such editor');
        return send(res, 200, 'text/html', readFileSync(f));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/pdf/')) {
        const id = slug(url.pathname.split('/')[2] || '');
        const f = join(TEMPLATES, id, 'source.pdf');
        if (!existsSync(f)) return send(res, 404, 'text/plain', 'no such pdf');
        return send(res, 200, 'application/pdf', readFileSync(f));
      }

      send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      send(res, 500, 'application/json', JSON.stringify({ ok: false, error: e.message }));
    }
  });
  server.listen(port, HOST, () => console.log(`ladder serve  →  http://${HOST}:${port}`));
  return server;
}
