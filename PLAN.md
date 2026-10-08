# Laddertech Ladder Drawing — PDF → SVG Plan

Status: **plan complete (2026-10-08) — Phase 0–3 + 1B/1C + MCP + pdf.js extractor + L2 geometry built; 57/57 tests. Open: Phase 4 (out of scope unless requested)**
Folder: `/Users/z/Documents/drawin`
Owner inputs: 3 reference PDFs in this folder, 1 existing HTML generator
Last updated: 2026-10-08

---

## 1. Objective

Turn a pile of drawing PDFs into structured, reusable outputs — **without assuming what any drawing is**.

Three layers, in order of certainty:

1. **Faithful SVG (always).** A vector conversion of any PDF — exact geometry, no classification, works for drawings we've never seen.
2. **Generic metadata (always).** Title-block fields (title, customer, drawing no./rev, material, finishing, date, load) plus **every dimension callout** with its value and position. No product assumptions.
3. **Parametric SVG (when a template matches).** Any drawing family can be **authored into a reusable template** from one example PDF; later PDFs of that family then render parametrically. Unmatched drawings simply stop at layers 1–2.

The existing HTML generator becomes **a template renderer/editor**, not the centre of the system. `cat` / `cage` / `trolley` are just the first three templates.

Runs **headless (CLI, for scale)** and **in-browser (the HTML, for interactive use)**.

**LLM: one vision pass, merged with rules** — to read title blocks and dimension callouts on arbitrary layouts (its strength). It never classifies the product and never generates geometry.

---

## 1a. Built so far (2026-10-08)

- **Converter chain + outline cleanup** — `ladder scaffold` converts (Inkscape → pdftocairo fallback) and hides coincident outline duplicates.
- **Merged extractor eval** — rules + one vision pass = 34/34 on the corpus; scoreboard in `src/eval/eval.mjs`.
- **Template L1 renderer** — `src/templates/render.mjs`: single-run, per-glyph group, and rotated (bottom-to-top) bindings; byte-identical in CLI and browser.
- **Auto-propose bindings** — `src/eval/scaffold.mjs` proposes the title block + dimensions (conservative on purpose).
- **`ladder serve`** — local upload → scaffold → live editor bridge (`src/serve.mjs`); no key needed.
- **Click-to-bind (id-anchored)** — click any text/number in the editor to add a parameter, anchored by element id so edits don't break it; persisted via `POST /bind`.
- **Formula layer** — params may carry `formula`; editing one value recalculates dependents (read-only, auto-updated fields).
- **Samples** — scaffold generates a `sample` so "Sample changes" works on any upload.
- **Phase 0 core rewire (0.7, done 2026-10-08)** — DOM-free `renderSVG(module, params)` in `src/core/` (modules/derive/text/render + assets) drives both the CLI and the HTML generator. The HTML loads a zero-dependency UMD bundle (`src/core/ladder-core.js`, built by `scripts/build-core.mjs`, classic `<script>` so `file://` works); all inline geometry was deleted from the HTML — it is now form + DOM wiring only. Snapshot tests in `test/render.snapshot.test.js` (fixtures + bundle↔ESM byte-parity) run via `npm test`.
- **Template registry (1C.1/1C.5, done 2026-10-08)** — `src/templates/registry.mjs`: loads `templates/*/template.json` (bad entries skipped, never fatal) + L3 code-model seeds; signal scoring (keywords/pattern/dimensions) with a threshold that a drawing-no pattern alone cannot pass; ties prefer real art over code models. `test/registry.test.js` (7 tests) locks the corpus mappings: 003 → `trolley-slt`, 004 → `cage-fhl`, 009 → `cat-l3`, unknown → `null`.
- **`ladder render` + Template mode (1C.6, done 2026-10-08)** — `src/templates/renderCmd.mjs` renders any registry entry (L1 real art with binding report, L3 code models through the core); the generator HTML has a Template mode fed by `templates/index.js` (metadata manifest from `scripts/build-manifest.mjs`; base art fetched per template over http, CLI pointed to on `file://`). `test/render-cmd.test.js` locks sample re-renders, defaults, L3 overrides, and manifest↔registry sync.

- [x] **`009` conversion fix** — the auto chain gained a Ghostscript repair hop: Inkscape crash → `gs -sDEVICE=pdfwrite` rewrite → Inkscape on the repaired PDF (text layer preserved) → pdftocairo. Chain order is unit-tested with a fake runner. *(Verified 2026-10-08 on Linux/Inkscape 1.4.3: this build does not reproduce the Mac 1.4.4 segfault — direct `inkscape` conversion of 009 succeeds and every `pdftotext` line is present in the output; the repair hop itself was exercised mechanically (`gs` rewrite → Inkscape on the repaired PDF → equivalent SVG), so both paths produce a faithful 009.)*

**Not built:** Phase 4 (exact 3D replicas — out of scope unless requested). Everything else in the plan is done.

---

## 2. Corpus & findings

All three are 1-page **Adobe Illustrator CC 23.1** exports with a **real text layer** (font subset `ArialMT`) plus a few embedded raster logos.

| File | Product | Module | Title-block family |
|---|---|---|---|
| `LSB-2607-003-RHC-R00.pdf` | Safety ladder trolley, 9 step, 60°, H 3500, 150KG, 980/700/2372 | `trolley` | NAR shop drawing |
| `LSB-2607-004-FHL-R00.pdf` | Cat ladder w/ safety cage, 6650 + 900, 7.5" brackets, 450/500/5000 | `cage` | NAR shop drawing |
| `LSB-2609-007-FHL-R00.pdf` | Cat ladder body type (facing), H 3210, 215/150, details 10051/10007 | `cat` | Laddertech sheet |

### Critical finding: text runs are fragmented per glyph

Extracted text looks like `6 6 0 0 mm`, `2 0 5 3 . 6`, `9 / 7 / 2 0 2 6`, `c anno t ac hie v e`.
Illustrator emits each run with its own placement, so **the extractor must stitch runs by x/y position before matching labels/values.** In the Inkscape SVG, 538 of 559 runs were single characters — the fragmentation is in the source and no converter removes it. Contained to one module (`stitch.js`).

### Consequence
The generator's title block matches the **Laddertech** sheet (the 009 style). The 003/004 sheets are **NAR shop drawings** with a different block (drawn-by, revision table, "Customer Chop & Sign"). So profiles are needed from day one: `nar` and `laddertech`.

### Resilience rule
**Channel A (conversion) must always succeed.** Even when field mapping is poor, every PDF yields a faithful SVG. Channel B uses whatever maps cleanly and reports the rest. The converter therefore uses a **fallback chain**, never a single tool (see §2a).

---

## 2a. Converter evaluation (measured 2026-10-07)

Inkscape 1.4.4 vs pdftocairo 26.10 on all three PDFs. Poppler was installed during this test.

| | **pdftocairo** | **Inkscape** (default importer) |
|---|---|---|
| Robustness (3 PDFs) | ✅ all 3 | ❌ **segfault (exit 139) on `LSB-2609-007-FHL-R00`** — reproducible |
| Text preserved | ❌ **0 `<text>`** — everything outlined | ✅ real, searchable text (560 / 725 runs) |
| Raw size — trolley | 7.60 MB | **4.87 MB** |
| Raw size — cage | 15.94 MB | **8.04 MB** |
| Gzip size — trolley | 1.46 MB | 1.43 MB |
| Gzip size — cage | 1.42 MB | **1.00 MB** |
| Renderer portability | ❌ librsvg refuses (`>500000 referenced elements`); Inkscape took **>300 s** to rasterize | ✅ renders normally |
| Fidelity vs original (mean \|Δ\|, %pixels>16) | cage 7.52 / 8.02%, cat 5.84 / 7.16% | tro 7.98 / 8.46%, cage 8.63 / 8.50% |

Both reproduce the drawing correctly (differences are anti-aliasing noise, no missing content).

**Conclusions that shape the design:**
- Inkscape gives **better output** (smaller, real text) but is **not reliable** (hard crash on 1 of 3).
- pdftocairo is **reliable** but **discards text** (outlines) and its SVG can exceed renderer limits.
- Other tested variants are rejected: Inkscape `--pdf-poppler` (9.66 MB, text lost, compositing-group errors) and `--export-text-to-path` (outlines only).

**Chosen behaviour — fallback chain:**
1. Try **Inkscape** (better text + size) with a timeout (~120 s).
2. On non-zero exit / crash → **fall back to pdftocairo** (guaranteed to work).
3. `--converter inkscape|pdftocairo|auto` (default `auto`) so the preference is explicit.

---

## 3. Locked decisions

- **Runtime: Node/JS.** One pure-JS core shared by CLI and browser (no duplicated geometry, no second rule engine).
- **No classification.** `productType` is *not* a field. Templates are matched optionally from generic metadata; an unmatched drawing still yields the exact SVG + metadata.
- **Extraction: generic metadata** — title-block fields + labelled values + **every dimension callout** (value, unit, position). Rules first; one vision pass merged in (concise prompt, full page at 200 dpi); never a second call.
- **LLM: extraction only.** Reads arbitrary layouts; never picks a product, never generates geometry.
- **Templates: bind, don't redraw.** A template = the converted example SVG + bindings from its text/geometry to named parameters (see §4a). Levels L1 text → L2 geometry → L3 hand-authored model (today's `cage`).
- **Converter: fallback chain** — Inkscape → pdftocairo (§2a). Always runs, for every PDF.
- **Corpus:** 3 PDFs, seeded as the first three templates; `nar` + `laddertech` title-block profiles.

---

## 4. Architecture

```
                 ┌──────────────── ladder-core (no DOM) ────────────────┐
                 │ modules.js   fields/ranges/defaults (single truth)   │
                 │ derive.js    overall(), cageModel()                  │
                 │ validate.js  range + geometry checks                 │
                 │ render.js    renderSVG(module, params) -> string     │
                 └───────┬──────────────────────────────┬──────────────┘
                         │                              │
        ┌────────────────▼──────────────┐   ┌───────────▼───────────────────┐
        │ Front end 1: HTML generator   │   │ Front end 2: CLI (Node)       │
        │  Load PDF -> extract -> fill  │   │  convert | extract | generate │
        │  form -> renderSVG -> export  │   │  verify | eval | batch        │
        └────────────────┬──────────────┘   └───────────┬───────────────────┘
                         │                              │
        ┌────────────────▼──────────────────────────────▼──────────────────┐
        │ extract/  pdfText -> stitch -> normalize -> fields -> profiles    │
        │           └─ llm.js  (optional: fills low-confidence fields)      │
        │ convert/  chain: Inkscape -> pdftocairo (auto)                    │
        │ eval/     A/B scoreboard: rules vs llm                            │
        └───────────────────────────────────────────────────────────────────┘
```

### Proposed repo layout

```
/Users/z/Documents/drawin/
  CS - Laddertech-Ladder-Drawing-Generator-cat.html   existing -> front end
  LSB-*.pdf                                            reference corpus
  PLAN.md                                              this file
  .env.example                                         template, no secrets
  .gitignore                                           must contain .env
  package.json
  vendor/
    pdf.min.js              pdf.js legacy UMD (sibling, added in P2)
    pdf.worker.min.js
  src/
    core/
      modules.mjs           module registry (cat | cage | trolley) + ranges/defaults
      derive.mjs            pure derived values (overall, cageModel+validation)
      text.mjs              esc/fmt/text/line/dimension helpers
      assets.js             base64 images for the cage sheet (generated)
      render.mjs            renderSVG(module, params) -> string
      ladder-core.js        UMD bundle of the above (generated: npm run build)
    extract/
      pdfText.js            getTextContent() -> items with coords
      stitch.js             merge glyph runs into tokens/lines   <-- risk area
      normalize.js          units/numbers/dates -> typed values
      fields.js             generic label/value patterns
      profiles/nar.js
      profiles/laddertech.js
      llm.js                provider adapter (vision + text)
      extract.js            extractParams(bytes) -> {module, params, confidence} (rules + one vision pass, merged)
    convert/
      convert.js            fallback chain (Inkscape -> pdftocairo)
    templates/
      registry.mjs          load + match templates (or null)
      render.mjs            L1 text / L2 geometry binding renderer (L3 = core/render)
      authoring.mjs         text inventory + auto-propose bindings
    eval/
      eval.mjs              rules vs llm scoreboard (rules/text/vision/merged)
  templates/                authored templates: <id>/{template.json, base.svg}
  bin/
    ladder.mjs              CLI entry
  scripts/
    build-core.mjs          ESM core -> UMD bundle (zero deps)
  test/
    render.snapshot.test.js  fixtures + bundle↔ESM parity
    fixtures/
```

**Why the core must be DOM-free:** `drawCat/drawTrolley/drawCage` currently read `document.getElementById(id).value` and write `innerHTML`. That locks the geometry to a browser page. Pulling it into `renderSVG(module, params) -> string` is the single highest-leverage change — it enables the CLI, batch, tests, and scripting.

---

## 4a. Template system (authoring)

A **template** turns one example drawing into a reusable parametric one — **bind, don't redraw**:

```jsonc
{
  "id": "trolley-slt",
  "name": "Safety Ladder Trolley (SLT)",
  "match": { "titleKeywords": ["LADDER TROLLEY"], "drawingNoPattern": "^LSB[-/].*" },
  "base": { "svg": "base.svg", "width": 1123, "height": 794 },   // exact converted art
  "params": [
    { "id": "footprint", "label": "Overall footprint", "type": "number", "unit": "mm", "min": 1200, "max": 5000 }
  ],
  "bindings": [
    { "value": "2,372",  "param": "footprint", "mode": "group" },
    { "ids": ["path1479"], "param": "footprint", "geom": { "op": "stretchX", "anchor": 2372 } },
    { "ids": ["path1478"], "param": "footprint", "geom": { "op": "shiftX", "anchor": 2372, "pxPerUnit": 0.10821 } }
  ]
}
```

Bindings today: `{"value": "…", "param": "…", "mode": "text"|"group"}` (anchor by text), or `{"ids": ["text1481", …], "param": "…", "mode": "id"}` (anchor by element id — stable across edits). A param may add `"formula": "footprint * 2"` to be computed from other params. **L2 geometry bindings** (1C.7): `{"ids": ["path1479"], "param": "…", "geom": {"op": "stretchX"|"stretchY", "anchor": <value-in-art>}}` scales a dimension line's matrix about its datum end by value/anchor; `{"op": "shiftX"|"shiftY", "anchor": …, "pxPerUnit": …}` translates a far-end arrowhead (full rate) or the dim text group (half rate, re-centring). Scaffold auto-proposes these: a dimension line is recognised structurally — a thin straight path with an arrowhead at each end spanning the dim text — and px/mm is self-calibrated per dim (extent/value), so no drawing scale is assumed.

**Rendering levels** (a template may mix them):
- **L1 — text:** replace the string of bound text nodes (title block, values). Covers most fields; trivial.
- **L2 — geometry:** move/resize bound nodes so dimension lines and parts actually track the value.
- **L3 — model:** a code template that emits SVG from a world model (today's `cage` is L3).

**Authoring flow (from one example PDF):**
1. Convert the PDF → `base.svg` (exact art).
2. Build a **text inventory** — every text run as `{id, string, bbox}` (the `stitch` step reused).
3. Auto-propose bindings by matching generic metadata against text runs (customer, drawing no., each dimension value).
4. Human/LLM confirms, names parameters, sets type/unit/range.
5. Save `templates/<id>/{template.json, base.svg}`.

**Known trap (found while proving the concept):** a converted SVG can contain a value **twice** — editable `<text>` *and* an outlined vector copy. Substituting the text leaves the outline as a ghost. The authoring step must detect this (a path whose bbox coincides with a text run) and **hide the outline copy**, or the converter must be chosen to avoid duplication. Not all values are duplicated (title-block text was clean; some dimension callouts were not), so it is per-artwork, per-element.

**Further authoring requirements (from the cage template):**
- **Horizontal dimensions** (`500.00`, `450.00`) bind cleanly as consecutive runs on one line.
- **Vertical / rotated dimensions** (the cage's `5360.40`, `6650.00`, `2053.60`, `146.00`) are emitted **one glyph per line, reading bottom-to-top**. **Handled:** the renderer reads the text advance direction from each run's `transform` matrix and groups accordingly (horizontal L→R, vertical bottom-to-top).
- **Glued title-block runs** occur (`Material…Finishing…Revision…Date…Page No…` as one text run), so those individual fields cannot be bound without splitting the run first.

**Matching** pools the `match` signals (title keywords, drawing-no pattern, dimension signature) and picks the best above a threshold; otherwise "no template" → layers 1–2 only.

**Why this shape:** it scales to *any* drawing family (author one example), keeps the exact Illustrator art, and never blocks on a new product type. The trolley sketch problem disappears — the trolley template is the real trolley art with editable values.

---

## 5. Phases and steps

### Phase 0 — Extract the core (no visual change)  ✅ done 2026-10-08

- [x] **0.1** `npm init`, ESM, `node:test` (or vitest). Node 22 already present.
- [x] **0.2** Create `src/core/modules.mjs`: field id, label, type, min/max/step, default, derived text per module. Single source of truth (the HTML form markup and MCP `inputSchema` still carry labels as presentation, but params/validation/CLI all read `modules.mjs`).
- [x] **0.3** Move helpers (`esc`, `fmt`, `n`, `text`, `line`, `dimensionX/Y`) to `src/core/text.mjs`.
- [x] **0.4** Move `drawCat` / `drawTrolley` / `drawCage` into `src/core/render.mjs` as `renderCat/renderTrolley/renderCage(params)`; replaced `$('id').value` reads with `params[id]`; functions **return** the SVG string. HTML sets `innerHTML`.
- [x] **0.5** Create `src/core/derive.mjs` (`overall(params)`, `cageModel(params)` incl. validation) and `src/core/validate.js` (folded into `modules.mjs` `rangeError` + `derive.mjs` geometry checks).
- [x] **0.6** Snapshot tests: `test/render.snapshot.test.js` renders each module at defaults into `test/fixtures/*.svg`; plus a bundle↔ESM byte-parity test. Proves the refactor is behaviour-preserving.
- [x] **0.7** Wire the HTML to the core: classic `<script src="src/core/ladder-core.js">` (UMD bundle from `scripts/build-core.mjs`, zero deps, works on `file://`); ~250 lines of inline geometry deleted from the HTML.

**Note on loading the core without breaking `file://`:** done as a UMD-style bundle — `src/core/ladder-core.js` attaches `window.LadderCore`, and `scripts/build-core.mjs` regenerates it from the ESM sources (run by `npm run build` / `pretest`). No bundler, no build step beyond that one Node script.

**Acceptance:** `node test/render.snapshot.test.js` passes; HTML opened from `file://` still draws correctly.

---

### Phase 1 — Rule-based extractor

- [x] **1.1–1.4** Extraction pipeline in `src/extract/`: `text.mjs` (pdftotext), `stitch.mjs` (raw/flat/sq views + company bridge), `normalize.mjs` (typed values), `rules.mjs` (field patterns incl. de-fragmentation on the sq copy + manufacturer disambiguation). *(Built; pdftotext as the text source — the pdf.js variant with coordinates is the browser extractor, Phase 2/7.)*
- [x] **1.5** Profiles: `profiles.mjs` — `nar` / `laddertech` / `generic` as data; nar canonicalises the drawing number to LSB and derives revision from its R-suffix. Detected on the corpus: 003/004 → nar, 009 → laddertech. *(Built.)*
- [x] **1.6** `extract.mjs`: orchestrate → `{ file, profile, module, params, core, confidence, warnings, unmappedText }`; typed fields, optional ONE vision pass filling rule blanks (cached by pdf+prompt hash, rules win on disagreement), validation against core ranges. Never throws for an unrecognised drawing. *(Built.)*
- [x] **1.7/1.8** Tests against all three PDFs (`test/extract.test.js`, corpus assertions for every rules anchor) + `warnings`/`unmappedText` as the coverage signal. *(Built.)*

**Acceptance:** ≥90% of the mapped fields extract correctly on each of the 3 PDFs, and every miss appears in `warnings`/`unmappedText`.

---

### Phase 1B — Merged extractor: rules + ONE vision pass  ← the specified design

Decided from the measurements below (rules 79% · vision 88% · **merged 100%**).

- [x] **1B.1** `src/extract/llm.js`: provider-agnostic adapter (OpenAI / Anthropic / Gemini / local) from env; returns structured JSON matching `modules.js`. *(Built.)*
- [x] **1B.2** **Vision = the full page at 200 dpi, never a crop.** Text mode is an optional cheap fallback only. *(Built — `pngOf()` in `src/extract/extract.mjs`; text mode kept only for the A/B scoreboard.)*
- [x] **1B.3** **Concise prompt.** Short system line + `Extract:` field list with one-line semantics + `Return JSON.`; no verbose prose (measured: concise 6/6, verbose 1/6). *(Built — `SYSTEM` + `promptFor()` in `src/extract/extract.mjs`, same wording as the probe.)*
- [x] **1B.4** **Merge policy:** rules win whenever they return a value; the single vision pass fills the blanks; values typed + validated against core ranges; vision-filled fields flagged medium confidence. *(Built — `src/extract/extract.mjs`; the eval `merged` column is the same policy.)*
- [x] **1B.5** **Cost control:** vision only when rules leave blanks (`--llm-whole` forces all fields); cache keyed by sha1(pdf + module + prompt) in `$TMPDIR/ladder-llm-cache`. *(Built — `visionFill()` in `src/extract/extract.mjs`.)*
- [x] **1B.6** **No second call.** Exactly one vision request per uncached PDF; no verify/re-read path exists in the extractor (the 65%-collapse probe stays in `src/eval/twopass.mjs` as counter-evidence). *(Built by construction.)*
- [x] **1B.7** `src/eval/scoreboard.mjs` (shared scoring core) + `src/eval/eval.mjs` (developer table) + `ladder eval [--with-text] [--json]`: per-field scoreboard (rules / text / vision / merged). Rules-only run reproduces the measured 27/34 (79%). *(Built.)*
- [x] **1B.8** Ground-truth discipline: `truth.mjs` fixtures were verified against high-DPI crops (the `3210`→`3200` correction happened there); new fixtures must be crop-verified before being trusted. *(Process — enforced at authoring time.)*

**Acceptance:** merged scores **34/34 (100%)** on the corpus, stable across runs.

#### Corpus result — `src/eval/tryExtractLLM.mjs` (2026-10-07)

Provider: Gemini `gemini-3.5-flash-lite` (alias `google_genai`). ~2.0–2.3 s (text), ~3.0–3.5 s (vision) per page; ~0.7–1.7k tokens.

| Module | TEXT | VISION | Main misses |
|---|---|---|---|
| trolley | 11/14 | **13/14** | text: dimensions (980 ↔ 700, nulls); vision: `60°` |
| cage | 6/10 | 8/10 | `productType` → `cat`, `6650` null, `450`↔`500` |
| cat | 9/10 | 9/10 | `overallHeight` null (text) / read `3200` (correct — the `3210` fixture was wrong; see resolution probe) |

**Findings**
- **Title-block text: strong.** Vision reliably returns `customer` / `drawingNo` / title. Text mode sometimes picks the wrong duplicate — the sheet carries two drawing numbers (`NAR-LA-LT-CL-060` vs `LSB-2607-003-RHC-R00`), two companies (`LADDERTECH` manufacturer vs `RAHABCO` customer) and two product names.
- **Dimensions proved mixed, not hopeless.** Early runs missed or confused some (`450` vs `500`, `980` vs `700`), but at 200 dpi with proper field semantics vision read the callouts correctly — and the `3200` was right all along. Rules own *labelled* numbers; vision owns *unlabelled* callouts.
- **Module classification is ambiguous** — the cage drawing is classified `cat` by both modes. Classify from explicit signals ("CAGE" / ring callouts), not the model's free choice.
- **Run-to-run variance** exists even at temperature 0.

**Verdict (superseded by the A/B eval below):** the LLM wins on **unlabelled dimension callouts and identity**; rules win on **labelled text and classification**. The shipped design is the **merge** of the two — see Phase 1B.

#### A/B eval — `src/eval/eval.mjs` (measured, 2026-10-07)

Rule baseline over `pdftotext`; LLM via Gemini `gemini-3.5-flash-lite`; vision page rendered at 200 dpi.

| Method | Score (34 fields, 3 PDFs) |
|---|---|
| rules (pdftotext) | 27/34 (79%) |
| LLM text | 28/34 (82%) |
| LLM vision | 30/34 (88%) |
| **merged: rules-first, vision-fill** | **34/34 (100%)** |

- **Rules** (free, deterministic) own labelled text: drawing no., revision, customer, material, finishing, working load, date, steps, angle, `Height : 3,500 MM`. Two fixes were required: (a) **de-fragmentation** — poppler emits `Heigh t : 6 650mm`, so height patterns match a whitespace-stripped copy; (b) **company disambiguation** — skip the manufacturer (`LADDERTECH` / `NEW AGE` / `NAR`) and bridge the `FHL CONSTRUCTION … Tel SDN BHD` split.
- **Vision** owns what never reaches the text layer: dimension callouts (`980 / 700 / 2372`, `450`, `900`) and identity on NAR-style sheets. 200 dpi + clearer field semantics lifted it 85% → 91%.
- **Merged (the pipeline)** = rules win when present, vision fills gaps: **100%**, stable over 3 runs.
- Cost: rules ~free; vision ~3–5 s/page and ~0.4–0.8 MB of image.

**Answer: the LLM helps substantially — but as *vision*, *layered on* rules.** Rules alone 79%, vision alone 88%, together **100%**. Neither alone reaches the pair. This is the pipeline to build: `extract = merge(rules(text), vision(png))`.

#### Two-pass does NOT help — `src/eval/twopass.mjs` (measured, 2026-10-07)

Every pass sees the **whole page** (no cropping).

| Method | Score |
|---|---|
| rules | 27/34 (79%) |
| read1 (one vision pass) | 31/34 (91%) |
| verify (2nd call re-checking read1) | **22/34 (65%)** |
| read2 (independent, temp 0.7) | 31/34 (91%) |
| consensus(read1, read2) | 31/34 (91%) |
| verify + consensus | 32/34 (94%) |

- **The model is already self-consistent:** read1 vs read2 agreement was 100% (14/14, 10/10, 10/10), so a second independent read and a consensus add nothing.
- **A "verify" second pass can collapse:** on the cat sheet it returned an empty result for every field (hence 65%).
- **It does not fix a field the model omits:** a general verify pass is not the mechanism (see the resolution/prompt probe below).
- **Decision: one vision pass, merged with rules. No second LLM call.**

#### Resolution & prompt probe (2026-10-07)

- Rendering the cat page at **150 / 200 / 300 / 400 dpi** returned the same reading every time — **resolution was not the limiting factor**.
- Reading the printed callout at 400 dpi (crop, for truth-checking only) showed **`3200`**: the earlier `3210` was a **ground-truth error of mine**, not a model error. Truth corrected to 3200.
- The field is **prompt-sensitive**: a concise prompt read it **6/6**; a verbose prompt **1/6**. Field semantics matter more than extra instruction prose.
- After correcting the truth and using the concise prompt: **merged = 34/34 (100%)**, stable over 3 runs.

**Answer to "does 300 dpi help?": no — the value was already being read correctly; the apparent failure was my wrong ground truth plus prompt verbosity, not resolution.**

---

### Phase 1C — Template system (authoring + L1/L2 rendering)

- [x] **1C.1** `src/templates/registry.mjs`: load `templates/*/template.json` (bad entries skipped, never fatal), match by pooled signals — +3 per title keyword, +2 drawing-no pattern, +1 per expected dimension; threshold 4 (a pattern alone must NOT match); ties prefer real-art L1 over L3 code models. Returns the winner or `null`. *(Built.)*
- [x] **1C.2** `src/templates/render.mjs`: **L1** text binding — replace the string of bound nodes. Handles single runs, per-glyph groups, and rotated (bottom-to-top) runs; also **id-anchored bindings** (stable across edits) and **formula params**. **L2 geometry binding renderer** (1C.7, built 2026-10-08): `src/templates/geometry.mjs` — `stretchX/stretchY` (scale a dimension line's matrix about its datum end by value/anchor) and `shiftX/shiftY` (translate arrowheads/text by (value−anchor)×pxPerUnit); applied after the text edits, located by element id, byte-identical in CLI and editor (ported into `editor.template.html`). *(Built.)*
- [x] **1C.3** `src/templates/authoring.mjs`: outline-duplicate cleanup via bbox coincidence (`inkscape --query-all`); binding auto-proposal lives in `scaffold.mjs`. *(Built.)*
- [x] **1C.4** `ladder scaffold <pdf>` — convert (Inkscape), hide outline duplicates, **auto-propose bindings** (title block + dimensions), write `templates/<id>/template.json`, and build the editor HTML. *(Built: `bin/ladder.mjs scaffold|editor|proof`.)*
- [x] **1C.5** Registry seeded: the 4 authored `templates/` dirs load as L1, plus built-in L3 seeds (`cat-l3`/`cage-l3`/`trolley-l3`) pointing at `src/core/render` — so the corpus matches end-to-end (003 → `trolley-slt`, 004 → `cage-fhl`, 009 → `cat-l3`) and an unmatched drawing still yields `null` → layers 1–2. *(Built; no CLI surface yet — that's 1C.6.)*
- [x] **1C.6** `ladder render <templateId> [params.json] [-o out.svg]` — renders L1 art templates (defaults apply for missing keys; binding report to stderr) and L3 code models via one code path (`src/templates/renderCmd.mjs`). The HTML generator gained **Template mode**: "Authored Template…" → pick template → edit its params → export SVG (art fetched per template; needs the folder served over http, with a clear pointer to the CLI on `file://`). Template metadata ships as `templates/index.js` (generated by `scripts/build-manifest.mjs`). *(Built.)*
- [x] **1C.7** Tests: author a template from one PDF, render with changed params, assert the new value appears and geometry tracks (L2). *(Built 2026-10-08: `test/geometry.test.js` — `applyGeometry` units, `proposeGeometry` units on synthetic query-all rows, real-art assertion that the trolley footprint line stretches by exactly value/anchor while the datum end stays put, and a 1C.7 end-to-end that scaffolds the real trolley PDF, renders its sample, and verifies every proposed stretch binding scaled by the sample/anchor ratio.)*
- [x] **1C.8a** LLM-proposed derived formulas on scaffold — `src/eval/formulas.mjs`: one text-only call (concise prompt, temp 0) sees the proposed numeric dims and returns which are derived from which; proposals validated numerically (whitelist `+ - * / ( )`, must reproduce the drawing's own value within 2%, `toFixed` to the target's decimals); manual formulas always win; `scaffold()` preserves hand-edits across re-scaffolds matched on **id + value** (positional dim ids shift when recall changes). *(Built 2026-10-08.)*
- [x] **1C.8b** **Geometry-aware formula proposal.** *(Built 2026-10-08.)* Scaffold now feeds `proposeFormulas` each dim's measure axis, text position, and glyph span (from the same `geom` metadata 1C.7 uses), so the model can propose structural rules — parallel dims that extend together, segment sums, constant offsets — instead of only fitted ratios. Same numeric validation as 1C.8a (must reproduce the drawing's own value within 2%); additive literals become named constant params (`<dimId>_cN`, editable, excluded from the sample, no art binding) while ratios stay inline; constants referenced by carried-over formulas survive re-scaffolds. `opts.llm` may be a function to inject a fake LLM (tests). *The measured gap is closed structurally: on `lsb-2607-004` the geometry (dim3's line extending in parallel with dim6) now reaches the model — 1C.8a only ever saw the values.* `test/formulas.test.js` (6 tests) locks the prompt shape, constant rewriting, validation rejections, and an e2e scaffold→formula→constant→render chain.

**Acceptance:** a template authored from `LSB-2607-003-RHC-R00.pdf` re-renders with a changed footprint/customer; an **unmatched** PDF still returns the converted SVG + metadata (never an error).

---

### Phase 2 — Both front ends

- [x] **2.1 (complete)** CLI `bin/ladder.mjs`: `convert` ✅, `extract` ✅, `generate` ✅ (extract JSON → matched template: L1 art with params bound by id-overlap, L3 model fallback), `verify` ✅ (extract → generate → every extracted dimension ≥10 confirmed present in the drawing's text layer, run or glyph group), `render` ✅, `eval` ✅, `serve/scaffold/editor/proof` ✅. Remaining from Phase 2: `batch` (3.1), MCP tools (2.5), HTML download-SVG (2.4), pdf.js spike (2.6).
- [x] **2.2** `src/convert/convert.mjs`: **fallback chain** — Inkscape (timeout 120s) → pdftocairo on crash/timeout/non-zero exit; `--converter auto|inkscape|pdftocairo` (default `auto`). `ladder convert in.pdf -o out.svg` wired; scaffold now uses the same chain (outline-cleanup only runs on the Inkscape path, which has the text layer). CI runs `npm test` before deploy. *(Built.)*
- [x] **2.3** **Superseded by `ladder serve`.** The generated editor loads a template, shows the source PDF (view-only), edits params live (with formulas), supports click-to-bind, and exports SVG. Browser-side extraction of a *new* PDF still needs the server (conversion is native). *(Built.)*
- [x] **2.4** **Download params** in the HTML: a ghost button next to "Download SVG" exports the current form/template values as JSON — module mode → `{module, values}` (feeds `ladder generate`), template mode → `{template, values}` (feeds `ladder render`). `generate`/`render` accept both payload shapes. *(Built.)*
- [x] **2.5** MCP: `bin/mcp.mjs` — stdio MCP server (newline JSON-RPC) exposing `import_ladder_pdf` → extracted params + confidence + warnings; and the HTML registers **`import_ladder_params`** alongside `configure_ladder_drawing` (apply an extract JSON or a Download-params payload to the drawing). *(Built.)*
- [x] **2.6** **`file://` pdf.js spike (P1 browser extractor)** — `src/extract/pdfjsText.mjs` clusters pdf.js text items into the same layout string the CLI uses, then runs the SAME stitch/rules pipeline (zero rule drift; measured on the corpus: equivalent field quality to poppler). `spike/pdfjs.html` proves the whole path in-browser from `file://` (main-thread pdf.js, no server). CLI poppler remains the extractor of record for font-broken PDFs. *(Built.)*

**Acceptance:** dropping a PDF into the HTML fills the form and redraws; CLI produces both SVG artefacts for the same PDF.

---

### Phase 3 — Scale

- [x] **3.1** `ladder batch ./pdfs --out ./out` — per PDF: `converted.svg`, `generated.svg`, `params.json`, `report.md`; plus a folder summary (`report.md` table + failures section). One bad PDF is reported, never fatal. *(Built: `src/batch.mjs`.)*
- [x] **3.2** Profiles as data — a new vendor is an entry in `src/extract/profiles.mjs`, no core changes. *(Built with 1.5.)*
- [x] **3.3** Tuning loop — `ladder eval` (scoreboard) + per-file `warnings`/`unmappedText` in batch params are the corpus feedback inputs. *(Built with 1B.7/3.1.)*

**Acceptance:** a folder of PDFs yields a complete, self-describing output set with a low-confidence summary.

---

### Phase 4 — Exact geometry (decision, likely no code)

Conversion already delivers exact output, including things the generator has no concept of (e.g. 009's detail insets `10051`, `10007`). Only build a parametric 3D replica if editable replicas of this drawing style are explicitly required. Out of scope unless requested.

---

## 6. Secrets & API key storage

**Rules**
- **Never** put a key in the HTML or any file that ships to a browser — client-side keys are public.
- **Never** commit a key. LLM calls run in the **Node CLI** only, reading the key from the environment.

**Recommended (simplest): project `.env`, loaded by the CLI**

`/Users/z/Documents/drawin/.env` (chmod 600, git-ignored):
```
LADDER_LLM_PROVIDER=openai          # openai | anthropic | gemini | local
LADDER_LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```
`/Users/z/Documents/drawin/.env.example` (committed, no secrets) mirrors the names with blank values.
`/Users/z/Documents/drawin/.gitignore` must contain:
```
.env
vendor/
node_modules/
out/
```
(This folder is not a git repo yet — add `.gitignore` anyway so it's safe the moment you `git init`.)

**More secure: macOS Keychain (no secret on disk in the project)**
```
security add-generic-password -a laddertech -s LADDER_LLM_API_KEY -w 'sk-...'
# then, in the shell / CLI wrapper:
export LADDER_LLM_API_KEY=$(security find-generic-password -a laddertech -s LADDER_LLM_API_KEY -w)
```

**Global option:** `~/.config/laddertech/.env` (chmod 600) if you want the key usable across projects.

**If you use OpenCode's own providers:** `opencode auth login` stores credentials separately in `~/.local/share/opencode/auth.json` (0600). That is for OpenCode itself — this project should still read its **own** env var so it works headless.

**Optional:** 1Password CLI — store the key as an item and run `op run -- node bin/ladder.mjs ...` so it's never in a file.

---

## 7. Verification strategy

- **Render snapshots** (P0) — refactor is behaviour-preserving.
- **Extraction fixtures** (P1) — known-good values from the 3 PDFs.
- **A/B eval** (P1B) — rules vs LLM per field, plus **ground-truth verification** (open a high-DPI crop before treating a value as correct).
- **Conversion golden test** (P2) — render converted SVG to PNG, compare to the original page render (pixel diff; already prototyped at ~6–9/255 mean Δ).

---

## 8. Commands / prerequisites

```bash
# one-time
brew install poppler            # pdftocairo / pdftotext / pdfinfo  (DONE 2026-10-07)
npm install                     # pdfjs-dist, dotenv, test tooling

# current
npm test                                        # rebuild bundle + snapshot/parity tests
npm run build                                   # regenerate src/core/ladder-core.js only
node bin/ladder.mjs serve                       # upload → scaffold → live editor at :8123
node bin/ladder.mjs scaffold "file.pdf"         # no server: build template + editor HTML
node bin/ladder.mjs proof templates/<id>        # before/after render check
node bin/ladder.mjs render trolley-slt sample.json -o out.svg   # re-render a template (L1 art or L3 model)

# target UX (not all built)
node bin/ladder.mjs convert "LSB-2607-003-RHC-R00.pdf" -o converted.svg
node bin/ladder.mjs extract "LSB-2607-003-RHC-R00.pdf" -o params.json
node bin/ladder.mjs extract "..." --llm-whole -o params.json   # force vision for all fields
node bin/ladder.mjs generate params.json -o generated.svg
node bin/ladder.mjs eval .
node bin/ladder.mjs batch . --out out
```

Available: Node 22, npm 10, Inkscape 1.4.4, Ghostscript 10.03, poppler 26.10.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Fragmented glyph runs break matching | Dedicated `stitch.js` (P1.2); tested against all 3 PDFs |
| **Inkscape segfault on some PDFs** | Fallback chain to pdftocairo (§2a); timeout + non-zero-exit handling |
| **pdftocairo outlines text / huge `<use>` graphs** | Prefer Inkscape when it succeeds; compress for delivery; don't rely on librsvg |
| `file://` blocks pdf.js worker / ES modules | Legacy UMD classic scripts; spike in P2.6; local server or CLI ingest fallback |
| Only 3 samples, same producer | Generic vocabulary + profiles; Channel A always outputs; add vendor PDFs as they arrive |
| LLM cost / hallucinated values | One vision pass, only for fields rules leave blank; values validated against `modules.js`; cached by PDF + prompt hash; no second call |
| API key leakage | Env/Keychain only; `.env` git-ignored; never in browser |
| Generator output ≠ PDF illustration | **Resolved by templates:** L1/L2 bind the *exact* converted art; L3 (hand-model) is optional |
| Template auto-binding proposes wrong targets | Confidence-scored proposals; human/agent confirms (step 1C.4) |
| L2 geometry is per-template effort | Ship **L1 first** (title block + values); L2 (1C.7) binds only dimension lines structurally — thin path + arrowhead pair + self-calibrated px/mm — and is auto-proposed conservatively |
| Rule drift between browser and CLI | Single JS ruleset shared by both |

---

## 10. Definition of done

- `renderSVG(module, params)` is DOM-free and tested; HTML output unchanged (snapshot fixtures + bundle↔ESM parity, `npm test`).
- The 3 reference PDFs each: (a) convert to a faithful SVG (with the fallback chain), and (b) extract to params that regenerate a correct drawing.
- `ladder eval` shows the merged extractor at **34/34 (100%)** on the corpus (rules 79%, vision 88%).
- Same logic runs headless and in-browser.
- New vendor = new profile entry (or LLM assist), no core changes.
- A **template** can be authored from one example PDF and re-rendered with changed parameters; **unmatched** PDFs return the converted SVG + generic metadata (never an error).
