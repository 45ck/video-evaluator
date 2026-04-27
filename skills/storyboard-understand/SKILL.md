---
name: storyboard-understand
description: Turn storyboard OCR into an evidence-backed product summary with likely views, capabilities, and open questions.
---

# Storyboard Understand

Use this after `storyboard-ocr` when an agent needs a first-pass
structured understanding rather than raw OCR lines.

This skill owns:

- app-name guesses from OCR evidence
- likely role/view extraction
- capability claims with cited lines and frame indices
- explicit open questions where inference is still weak

## Inputs

Provide either `storyboardDir` or `ocrPath`:

```json
{
  "storyboardDir": "./output/storyboard"
}
```

If `storyboard.transitions.json` exists in the storyboard directory, the skill
can incorporate transition-derived flow segments.

## Outputs

The skill writes `storyboard.summary.json`. The summary includes app-name
guesses, likely views, OCR quality notes, sampling notes, interaction segments,
likely flow, capability claims with frame/line evidence, text-dominance signals,
and open questions.

## Sequencing Guidance

Run after `storyboard-ocr`. For stronger flow summaries, run
`storyboard-transitions` first. Use this output to orient a reviewer, then
verify important claims against `storyboard.ocr.json` and the source frame
images.

## Interpretation Notes

Capability claims are pattern-based and must cite OCR evidence. App names and
view names are guesses, especially when OCR is sparse or narration text
dominates. `textDominance.likelyNarrationDominated` means the sampled text may
describe the product rather than come from the UI itself.

## Abstention Rules

Do not present guesses as facts. Abstain from final product claims when
`ocrQuality.lowSignal` is true, most frames are weak/rejected, or the relevant
claim appears only in narration-like text. Keep open questions visible rather
than filling gaps from domain assumptions.

## Failure Modes

Missing OCR input fails the run. Missing transitions does not fail the run, but
flow and interaction segments may be less specific. Poor sampling or OCR noise
can produce generic app/view labels; inspect evidence before reusing them.

Repo-side runner:

`node --import tsx scripts/harness/storyboard-understand.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-understand`
