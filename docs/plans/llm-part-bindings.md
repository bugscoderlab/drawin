# Plan: LLM part-binding proposals (spec #15)

**Status:** implemented (tickets #16, #17). Design follows the
[vision-dimension-recovery](vision-dimension-recovery.md) house pattern: the
model produces *judgement*, the deterministic pipeline keeps *truth*.

## Problem

The deterministic part proposal (spec #8) is deliberately conservative: the
span rule (±10%, both ends on the dim's end planes), the attach rule (wholly
on the moving side, edge on the moving plane), and all-or-nothing ambiguity.
On real shop art this binds the obvious members and skips the ambiguous
middle — the motivating case (`lsb-2607-003-rhc-r00` front view, analysed
2026-10-09): dim1 (980 mm platform width) bound 33 elements but left ~60
skipped, among them connection plates *crossing* the moving plane. The edit
result: rails stretch into a still-static staircase. The drawing looks
half-moved.

## Contract: the model picks membership, the engine keeps the math

After the deterministic part stage, for each recognised dim whose proposal
left **skipped candidates**, the pass (`src/eval/partsLlm.mjs`,
`proposeLlmParts`) asks the model one question: which elements does this
dimension measure, and how — `spans` (stretch between the end planes) or
`attached` (rides the moving end)?

The model receives:

- one page image per scaffold (rendered lazily from the source PDF, reused
  across dims — same as the vision dim pass),
- the dim's geometry in page px: value, measured axis, the dimension line's
  end coordinates, and which end is the datum (fixed) side,
- a **candidate table**: the unclaimed query-all rows inside the dim's
  locality box — the exact pool the deterministic rules classified. The table
  is the only source of valid ids.

The model replies `{"spans": [ids], "attached": [ids]}`. It never emits
coordinates, scales, or transforms.

The engine then:

1. **validates** every id against the candidate table (exists in the art,
   unclaimed, inside the locality box). Rejections are collected with reasons
   and counted in the report — never thrown (resilience rule).
2. **derives the op** from the role: `spans` → `stretchX/Y` with the `about`
   end on the datum side (the same `deriveAbout` the span rule uses — one
   definition of the pinned end); `attached` → `shiftX/Y`.
3. **calibrates itself**: `anchor` = the dim value, `pxPerUnit` = the dim's
   own extent/value. Calibration can never come from the model.
4. **merges under the shared `claimed` set** (`mergeLlmParts`): one element
   binds to at most one dimension; an id picked twice (or for two dims) is
   rejected; accepted ids join the fresh-bound set so the preserve step
   (issue #12) can never carry a colliding hand-made binding.

Ambiguity is not silently resolved: a dim the deterministic stage flagged
`ambiguous` keeps the flag in the report even when the model adds bindings.

## Report

Per-dim counts gain a provenance split, and a summary line counts the
pass's influence (fake-call run on the real 004 PDF):

```
  parts     : 8 dimension(s) propose part bindings
     dim1        89 bound (86 rule, 3 llm), 72 skipped
     ...
  llm parts : 8 dim(s) asked, 3 binding(s) accepted, 2 id(s) rejected
```

(Fake-call run on the real 004 PDF: the model proposed the ladder-body
rungs for dim1 — legitimate candidates the span rule rejects on extent
tolerance (55.9 px vs 39.5 px) — plus two bogus ids. The rungs were accepted
and engine-calibrated; the bogus ids never entered the candidate table. The
guard against wrong membership is the model's judgement and the visible
rule/llm split, not the locality box.)

## Gating

- `opts.llm === false` disables the pass (tests, `--no-llm` flows, the VPS).
- Without a key (`src/config/env.mjs`) the pass is a quiet no-op, like the
  vision dim recovery — no secrets are needed on the server.
- `opts.llm` as a function injects a fake LLM (the test seam; every unit test
  uses it, no network).
- One dim's failed/timeout call never fails the scaffold — that dim keeps its
  deterministic result.

## Preserve semantics

LLM-proposed bindings are **auto-proposed**, exactly like rule-proposed ones:
recomputed on every scaffold, never carried by the preserve merge; `--force`
wipes them. A dim whose proposal came *only* from the LLM counts as
reproduced (`bound > 0`), so a hand-made binding for the same dim is not
carried — re-run the scaffold where the key lives to reproduce it.

## Limitations (v1)

- No reply caching (issue #5's vision-cache pattern applies; later).
- No editor UI for inspecting or overriding llm-proposed bindings — the
  report and hand-authored JSON remain the surface.
- The model sees the whole page, not a per-dim crop (the candidate table is
  the precise instrument; the image is context).
- A dim with zero skipped candidates is never asked — the rules already
  classified everything in its box.
