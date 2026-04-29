---
name: layout-safety-review
description: Check a local video against layout annotations, safe zones, OCR text boxes, and frame samples so agents can catch cropped content, caption overlap, unreadable overlays, and platform-unsafe composition before shipping.
---

# Layout Safety Review

Use this after a video has been rendered and, when available, after the render
has produced a `.layout.json` sidecar. The goal is to catch visual layout
failures that normal metadata checks miss.

This skill owns:

- sampled frame inspection for layout safety
- optional OCR over sampled frames
- safe-zone and caption-zone overlap checks
- layout annotation pair overlap checks
- `layout-safety.report.json`

## Inputs

Use a rendered video path. Add `layoutPath` when the producer can emit layout
annotations:

```json
{
  "videoPath": "./output/final.mp4",
  "layoutPath": "./output/final.layout.json",
  "outputDir": "./output/review",
  "samplingMode": "hybrid",
  "runOcr": true
}
```

`samplingMode` may be `uniform` or `hybrid`. Use `hybrid` for short-form
videos because it samples both timeline coverage and visually interesting
moments. `runOcr` defaults to `true`.

`layoutPath` should be a producer-owned sidecar when available. For Remotion,
HTML, SVG, or canvas renders, ask the producing agent to emit named boxes for
primary subject, cards, captions, UI, decorative elements, and platform chrome
so the reviewer can tell whether overlap is intentional or a real defect.

## Outputs

The runner writes `layout-safety.report.json` in `outputDir` when supplied, or
next to the video/review artifacts when the harness resolves an output
directory. The report includes sampled frames, layout annotations, OCR boxes,
issues, thresholds, and an overall status.

## Review Rules

Fail or send back the render when:

- captions overlap primary subject, gameplay seams, post cards, or UI regions
- important layout boxes are cropped outside the frame
- two producer-declared layout boxes overlap more than the configured threshold
- OCR text lands in platform chrome or unsafe margins
- the report has layout issues and the video is intended as a showcase example

Warn when evidence is weak: missing layout sidecar, sparse OCR, too few sampled
frames, or generated visuals that are hard to classify. A warning is not a pass
for showcase videos; inspect the frames manually.

## Sequencing Guidance

Run after `review-bundle` or directly after render. Pair with
`storyboard-extract`/`storyboard-ocr` when the question is not only geometric
layout but whether visible text or UI content is correct.

Run `package-review-prompt` after this skill when delegating review to another
agent. The prompt will surface `layout-safety.report.json` and make it the next
artifact to inspect when the report is failing or warning.

For `content-machine`, prefer using producer `.layout.json` sidecars from
Remotion/HTML/SVG renders. For `demo-machine`, use it as evidence feeding the
local `quality.json`; do not replace demo-specific selector or narration-order
checks.

## Failure Modes

Without a layout sidecar, the runner can still sample frames and run OCR, but it
cannot know producer intent. If OCR is unavailable or low confidence, inspect
the sampled frames directly before concluding text placement is safe.

Repo-side runner:

`node --import tsx scripts/harness/layout-safety-review.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs layout-safety-review`
