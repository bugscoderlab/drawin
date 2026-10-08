# Localhost verification runbook

Step-by-step verification of the 2026-10-08 work (009 repair verification, 1C.7
L2 geometry bindings, 1C.8b geometry-aware formulas) on the owner's machine.

Repo: `/Users/z/Documents/drawin` — run everything from there.
Expected platform: macOS, Inkscape 1.4.4 (the build that segfaults on 009 — that
is what step 4 exercises), Node 22, poppler. On macOS no font fix is needed
(Arial ships with macOS, so Inkscape keeps the text layer; the `ArialMT` font
install was Linux-only — see `wiki/Conversion.md`).

Each step: **Run** → **Expect**. Stop and report at the first failure.

> **Status: verified 2026-10-08 on the owner's Mac** (Node v22.23.2,
> Inkscape 1.4.4, poppler 26.10.0, Ghostscript 10.03.0). All steps pass;
> notes inline where the machine differed from the original expectations.

---

## 0. Prereqs

```bash
cd /Users/z/Documents/drawin
node --version            # expect v22.x
inkscape --version        # expect 1.4.x
pdftocairo -v 2>&1 | head -1   # expect poppler 2x.x
npm install               # pdfjs-dist, dotenv, test tooling
```

## 1. Full test suite

```bash
npm test
```

**Expect:** `# pass 64`, `# fail 0`. (Was 63 — one chain test added when the
009 repair hop gained a second rewriter, see step 4.) Includes the new
`test/geometry.test.js` (7 tests) and `test/formulas.test.js` (6 tests), both
of which scaffold the real trolley PDF and are skipped only if Inkscape is
missing.

> Note: on machines with an LLM key in `.env`, the rules-only scoreboard test
> used to fail (`key` was reported even when no LLM pass ran). Fixed in
> `src/eval/scoreboard.mjs`: `key` is now reported only when a text/vision
> pass actually ran.

## 2. L2 geometry — visual proof (trolley footprint)

```bash
node bin/ladder.mjs proof templates/trolley-slt
```

**Expect:** PNGs written to `preview/trolley-slt/`. Open `0_COMPARE.png` (or
`2_BEFORE_base.png` next to `3_AFTER_changed.png`):
- the footprint text reads **3200** (was 2372 — the template's sample edit;
  earlier revision of this runbook said 2609), and
- its dimension line is visibly **longer**, the right arrowhead moved with it,
  and the text stayed centred on the line.

The proof's binding report also lists the geometry hops, e.g.
`OK footprint geom stretchX x1.34907` — one stretch for the line, two shiftX
at full/half rate for the arrowhead and the centred text.

Interactive equivalent: open `preview/trolley-slt-editor.html` in a browser,
press **Sample changes**, and watch the dimension line track the value live.

## 3. L2 geometry — numeric proof

```bash
node bin/ladder.mjs render trolley-slt '{"footprint":"3200"}' -o /tmp/after.svg
```

(The render command now also accepts inline JSON; a params file path works
too.)

**Expect:** `3200` appears in `/tmp/after.svg`, and the dimension line
stretched by exactly 3200/2372. Verified values (Inkscape pretty-prints the
SVG across lines, so collapse newlines before grepping):

```bash
# line matrix scale went 1.3333333 -> 1.79876 (= 1.3333333 × 3200/2372), x translation unchanged at 145.39973
tr '\n' ' ' < /tmp/after.svg | grep -o 'id="path1479"[^>]*transform="matrix([^"]*)"'
# far-end arrowhead translated +89.6 in x (402.07027 -> 491.66815)
tr '\n' ' ' < /tmp/after.svg | grep -o 'id="path1478"[^>]*transform="matrix([^"]*)"'
```

## 4. 009 repair hop (the path Linux could not reproduce)

```bash
node bin/ladder.mjs convert "LSB-2609-007-FHL-R00.pdf" -o /tmp/009.svg
grep -c '<text' /tmp/009.svg
```

**Expect:** `converted with inkscape (repaired)`, and a text layer
(`grep -c` > 0).

> macOS/Inkscape 1.4.4 finding (the point of this step): Inkscape segfaults on
> 009 with BOTH importers, and — unlike Linux/Inkscape 1.4.3 — the
> Ghostscript `pdfwrite` rewrite does **not** cure the crash (every
> `-dPDFSETTINGS` variant still segfaults; only `-dNoOutputFonts` helped,
> which kills the text layer). The chain now has a second repair hop:
> `pdftocairo -pdf` rewrite → Inkscape, which cures the crash and keeps a
> real text layer (17 runs on 009: customer, drawing no, title, date, load,
> …). Gotcha encoded in `src/convert/convert.mjs`: `pdftocairo -pdf` does
> not append `.pdf` to the output name. See `wiki/Conversion.md` step 2b.

## 5. Scaffold auto-proposes geometry bindings

```bash
node bin/ladder.mjs scaffold "LSB-2607-004-FHL-R00.pdf" --force   # fresh scaffold (wipe)
# (re-scaffold is preserve-by-default: --force is what discards prior params/bindings)
```

**Expect:** output includes `geometry : 6 dimension line(s) track their
value`. Then (template.json is pretty-printed, so match the space):

```bash
grep -c '"geom":' templates/lsb-2607-004-fhl-r00/template.json   # expect 18
grep -oE '"(stretch|shift)[XY]"' templates/lsb-2607-004-fhl-r00/template.json | sort | uniq -c
```

**Expect:** 18 `geom` bindings — per dim a `stretchX`/`stretchY` (the line)
plus two `shiftX`/`shiftY` (arrowhead at full rate, dim text at half rate).

## 6. Geometry-aware formulas + named constants (needs an LLM key)

Requires `.env` (see `.env.example`): `LADDER_LLM_PROVIDER`, `LADDER_LLM_MODEL`,
and the provider's API key.

```bash
node bin/ladder.mjs scaffold "LSB-2607-004-FHL-R00.pdf"
grep '"formula"' templates/lsb-2607-004-fhl-r00/template.json
```

**Expect:** at least one param carries a `formula` (verified: dim5 and dim6
got `(dim6 * 0.383104).toFixed(2)` / `(dim2 * 0.806075).toFixed(2)`).
Named constants (`"const":true`, id like `dim6_c1`) appear only when a
validated formula carries an additive (+/-) literal — this run's proposals
were purely multiplicative, so no constants were extracted (correct
behaviour; the extraction path itself is unit-tested in
`test/formulas.test.js`). Without a key this step is silently skipped
(scaffold still succeeds) — not a failure.

## 7. End-to-end in the browser

```bash
node bin/ladder.mjs serve
# open http://localhost:8123, upload LSB-2607-004-FHL-R00.pdf (or 003),
# edit a dimension, confirm the dimension line moves in the preview
```

**Expect:** upload → editor opens → editing a bound dimension updates both its
text and its line/arrowhead position. Verified server-side over HTTP (upload →
scaffold → editor 200) and through the same render path the editor uses:
editing dim2 to 8000 re-rendered the 004 template with the dimension line's
Y-scale stretched by exactly 8000/6650, translation unchanged.

> Note: 009 is the wrong PDF for this step — its dimension annotations are
> vector outlines even in the source PDF (no extractable dim text;
> `pdftotext` shows only the title block), so only its title-block fields
> can bind. Use 003 or 004 to watch geometry move.

---

## Definition of done

- [x] `npm test` → 64/64
- [x] proof PNGs show the footprint line tracking (step 2)
- [x] path1479/1478 matrices numerically correct (step 3)
- [x] 009 converts via a repair hop with text layer (step 4 — via the new
      `pdftocairo -pdf` hop: the `gs` hop does not cure macOS 1.4.4)
- [x] scaffold proposes `geom` bindings on a fresh PDF (step 5)
- [x] (with key) formula params appear; constants appear when formulas carry
      additive literals (step 6)
- [x] serve → upload/scaffold/editor verified; geometry moves on re-render
      (step 7)
