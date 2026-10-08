# Extraction: PDF → structured params

`ladder extract` turns a drawing PDF into generic metadata — **without assuming what the drawing is**. Channel B of the pipeline (Channel A is [Conversion](Conversion.md)).

```bash
node bin/ladder.mjs extract "LSB-2607-004-FHL-R00.pdf" -o params.json
node bin/ladder.mjs extract "file.pdf" --llm-whole    # force vision for every field
node bin/ladder.mjs extract "file.pdf" --no-llm       # rules only (free, deterministic)
```

## How it works

```
pdftotext -layout → stitch → rules → profile fixes → [ONE vision pass for blanks]
  → validate → { module, params, core, confidence, warnings, unmappedText }
```

1. **stitch** — pdftotext output gets three views: `raw` (column boundaries intact), `flat` (single-spaced), `sq` (whitespace stripped). Illustrator exports fragment glyphs (`Heigh t : 6 650mm`), so label patterns match on `flat` and number patterns on `sq`.
2. **rules** (`src/extract/rules.mjs`) — generic field patterns: drawing no., revision, customer, material, finishing, date, working load, steps, angle, `Height : A + B`. Company detection skips the manufacturer (LADDERTECH / NEW AGE / NAR) and bridges the `FHL CONSTRUCTION … Tel SDN BHD` split. `productType` comes **only** from explicit keywords — never from the LLM.
3. **profiles** (`src/extract/profiles.mjs`) — sheet families as data: `nar` (NAR shop drawing: canonicalises the drawing number to the LSB one, derives revision from its `R00` suffix), `laddertech`, `generic`. New vendor = new entry, no code.
4. **vision fill (optional)** — if an API key is configured (`.env`, see [Secrets](Secrets.md)), **one** vision pass (full page @200dpi, concise prompt) fills the fields rules left blank. Rules win on disagreement; results cached by pdf+prompt hash. Never a second call (measured: a verify pass can collapse the score to 65%).

## Output shape

```jsonc
{
  "file": "LSB-2607-004-FHL-R00.pdf",
  "profile": "nar",                    // sheet family that matched
  "module": "cage",                    // cat | cage | trolley (keyword-classified)
  "params": { "drawingNo": "LSB/2607/004/FHL/R00", "floorToLanding": 6650, ... },
  "core": { "cageLadderHeight": 6650 }, // params mapped to generator field ids
  "confidence": { "drawingNo": { "source": "rules", "level": "high" }, ... },
  "warnings": [ "missing field: ladderWidth", ... ],
  "unmappedText": [ /* drawing lines no field consumed */ ]
}
```

Missing fields are `null` + a warning — an unrecognised drawing is **not** an error (layers 1–2 always succeed).

## Known text-layer gaps (vision's job)

Rules alone measured **27/34 (79%)** on the corpus. What rules can't see, by design:

- dimension callouts that never reach the text layer (cat's `3200`, trolley platform dims `980/700/2372`)
- NAR trolley sheet's Material/Finishing (labels absent from the text layer)

Merged (rules + one vision pass) measured **34/34 (100%)**, stable over 3 runs. Vision needs a key: `LADDER_LLM_PROVIDER` + the provider key in `.env`.

## Requirements

poppler (`pdftotext`, `pdftocairo` for the vision image) — in the Docker image; macOS: `brew install poppler`. LLM key optional; everything except vision-fill works without it.
