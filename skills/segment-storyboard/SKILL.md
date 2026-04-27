---
name: segment-storyboard
description: Extract at least one storyboard frame per video shot segment so later OCR and segment evidence fusion can cover gaps missed by global sampling.
---

# Segment Storyboard

Use this after `video-shots` when global storyboard sampling misses many shot
segments or `segment.evidence.json` reports too many `empty` segments.

This skill owns:

- reading `video.shots.json`
- extracting one to three frames per shot
- writing a standard `storyboard.manifest.json` under `segment-storyboard/`
- making the output reusable by `storyboard-ocr`, `storyboard-transitions`, and
  `segment-evidence`

## Inputs

Use the same bundle locators as `video-artifact-intake`:

```json
{
  "outputDir": "./output/example-run",
  "framesPerSegment": 1,
  "format": "jpg"
}
```

`framesPerSegment` defaults to `1` and is capped at `3`. `storyboardOutputDir`
is optional and defaults to `./segment-storyboard` inside the run directory.

## Outputs

The result contains `manifestPath` and `manifest`. The manifest is compatible
with `storyboard-ocr`; each frame includes `sourceShotIndex` and
`segmentPosition` for traceability.

## Sequencing Guidance

Run:

1. `video-shots`
2. `segment-storyboard`
3. `storyboard-ocr` with `storyboardDir` set to the generated
   `segment-storyboard/` directory
4. optionally `storyboard-transitions`
5. `segment-evidence`

When both `storyboard/` and `segment-storyboard/` exist, intake prefers
`segment-storyboard/` for review because it gives every shot a coverage chance.

## Interpretation Notes

This improves coverage, not understanding. It gives OCR and reviewers a frame
inside each shot, but static frames can still miss motion, clicks, narration, or
short-lived UI states.

Repo-side runner:

`node --import tsx scripts/harness/segment-storyboard.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs segment-storyboard`
