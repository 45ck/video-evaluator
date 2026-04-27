---
name: storyboard-transitions
description: Infer frame-to-frame transitions from storyboard image diffs and OCR deltas, then write an evidence-backed transition manifest.
---

# Storyboard Transitions

Use this after `storyboard-ocr` when an agent needs sequence-level
change evidence instead of isolated sampled frames.

This skill owns:

- image-level diff between adjacent storyboard frames
- OCR text additions and removals
- coarse transition kinds such as `screen-change` or `state-change`
- overlap/shared-line signals for same-screen heuristics
- heuristic transition labels with confidence
- `storyboard.transitions.json`

## Inputs

Provide either `storyboardDir` or `ocrPath`:

```json
{
  "storyboardDir": "./output/storyboard",
  "threshold": 0.02
}
```

`threshold` is the normalized visual-diff sensitivity and defaults to `0.02`.

## Outputs

The skill writes `storyboard.transitions.json` with adjacent-frame transitions.
Each transition includes frame indices, timestamps, visual diff percentage, OCR
overlap, shared line count, added/removed lines, transition kind, confidence,
and evidence notes.

## Sequencing Guidance

Run after `storyboard-ocr`. It benefits from hybrid extraction because
same-screen sampling metadata can support state-change interpretation. Run
`storyboard-understand` after this when you want a higher-level flow summary
that can incorporate transition evidence.

## Interpretation Notes

`screen-change` suggests a broader view change. `state-change` suggests the
same shell with changed content. `scroll-change` and `dialog-change` depend on
stable anchors, OCR regions, and visual deltas. `uncertain` is expected when
OCR was rejected or adjacent frames have too little shared evidence. Confidence
is heuristic, not a probability.

## Abstention Rules

Do not infer user intent or causal actions from transitions alone. Abstain from
precise workflow claims when transition confidence is low, OCR quality is
rejected, or frame sampling skips the moments between two states.

## Failure Modes

The runner needs existing OCR output and accessible frame images. Missing OCR,
missing images, or `ffmpeg` failures during diff preprocessing will fail the
run. Very small threshold values can over-label visual noise; high values can
hide subtle UI changes.

Repo-side runner:

`node --import tsx scripts/harness/storyboard-transitions.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-transitions`
