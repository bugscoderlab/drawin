# Localhost verification runbook

Step-by-step verification of the 2026-10-08 work (009 repair verification, 1C.7
L2 geometry bindings, 1C.8b geometry-aware formulas) on the owner's machine.

Repo: `/Users/z/Documents/drawin` — run everything from there.
Expected platform: macOS, Inkscape 1.4.4 (the build that segfaults on 009 — that
is what step 3 exercises), Node 22, poppler. On macOS no font fix is needed
(Arial ships with macOS, so Inkscape keeps the text layer; the `ArialMT` font
install was Linux-only — see `wiki/Conversion.md`).

Each step: **Run** → **Expect**. Stop and report at the first failure.

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

**Expect:** `# pass 63`, `# fail 0`. This includes the new `test/geometry.test.js`
(7 tests) and `test/formulas.test.js` (6 tests), both of which scaffold the real
trolley PDF and are skipped only if Inkscape is missing.

## 2. L2 geometry — visual proof (trolley footprint)

```bash
node bin/ladder.mjs proof templates/trolley-slt
```

**Expect:** PNGs written to `preview/trolley-slt/`. Open `0_COMPARE.png` (or
`2_BEFORE_base.png` next to `3_AFTER_changed.png`):
- the footprint text reads **2609** (was 2372), and
- its dimension line is visibly **longer**, the right arrowhead moved with it,
  and the text stayed centred on the line.

Interactive equivalent: open `preview/trolley-slt-editor.html` in a browser,
press **Sample changes**, and watch the dimension line track the value live.

## 3. L2 geometry — numeric proof

```bash
node bin/ladder.mjs render trolley-slt '{"footprint":"3200"}' -o /tmp/after.svg
```

**Expect:** `3200` appears in `/tmp/after.svg`, and the dimension line stretched
by exactly 3200/2372. Verify:

```bash
# line matrix scale went 1.3333333 -> ~1.7985, translation unchanged at 145.39973
grep -o 'id="path1479"[^>]*transform="matrix([^"]*)"' /tmp/after.svg
# far-end arrowhead translated +~89.6 in x (402.07027 -> ~491.67)
grep -o 'id="path1478"[^>]*transform="matrix([^"]*)"' /tmp/after.svg
```

## 4. 009 repair hop (the path Linux could not reproduce)

```bash
node bin/ladder.mjs convert "LSB-2609-007-FHL-R00.pdf" -o /tmp/009.svg
grep -c '<text' /tmp/009.svg
```

**Expect:** on macOS, Inkscape 1.4.4 segfaults on this PDF, so the auto chain
takes the Ghostscript repair hop and finishes with Inkscape on the repaired PDF
(result reports `repaired: true`). Output SVG exists and contains a text layer
(`grep -c` > 0; on your Mac build it should be the full text layer, not just
aria-label outlines).

## 5. Scaffold auto-proposes geometry bindings

```bash
node bin/ladder.mjs scaffold "LSB-2607-004-FHL-R00.pdf"
```

**Expect:** output includes `geometry: N dimension line(s) track their value`
with N ≥ 1. Then:

```bash
grep -o '"geom":{[^}]*}' templates/lsb-2607-004-fhl-r00/template.json | head
```

**Expect:** `geom` bindings with `op` `stretchX`/`stretchY` (dimension lines)
and `shiftX`/`shiftY` (arrowheads at full rate, dim text at half rate).

## 6. Geometry-aware formulas + named constants (needs an LLM key)

Requires `.env` (see `.env.example`): `LADDER_LLM_PROVIDER`, `LADDER_LLM_MODEL`,
and the provider's API key.

```bash
node bin/ladder.mjs scaffold "LSB-2607-004-FHL-R00.pdf"
grep -E '"formula"|"const"' templates/lsb-2607-004-fhl-r00/template.json
```

**Expect:** at least one param carries a `formula`, and additive offsets in
validated formulas appear as named constant params (`"const":true`, id like
`dim6_c1`) instead of buried numbers. Without a key this step is silently
skipped (scaffold still succeeds) — not a failure.

## 7. End-to-end in the browser

```bash
node bin/ladder.mjs serve
# open http://localhost:8123, upload any of the three LSB PDFs,
# edit a dimension, confirm the dimension line moves in the preview
```

**Expect:** upload → editor opens → editing a bound dimension updates both its
text and its line/arrowhead position.

---

## Definition of done

- [ ] `npm test` → 63/63
- [ ] proof PNGs show the footprint line tracking (step 2)
- [ ] path1479/1478 matrices numerically correct (step 3)
- [ ] 009 converts via the repair hop with text layer (step 4)
- [ ] scaffold proposes `geom` bindings on a fresh PDF (step 5)
- [ ] (with key) formula + constant param appear (step 6)
- [ ] serve → browser editing moves geometry (step 7)
