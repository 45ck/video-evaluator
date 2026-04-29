---
name: video-technical-review
description: Review a rendered video for technical defects such as resolution mismatch, missing or near-silent audio, black or white frames, edge gutters, low motion, sparse caption bands, and layout issue pass-through.
---

# Video Technical Review

Use this after a video has been rendered and you need a deterministic technical
audit before human or model review.

This skill owns:

- probing video resolution, duration, frame rate, and audio streams
- sampling frames for black/white frames, bright edges, black gutters, caption
  band sparsity, and low-motion runs
- measuring audio volume when an audio stream exists
- preserving known issue codes from content-machine audit reports
- writing `video-technical.report.json`, `contact-sheet.png`, and
  `contact-sheet.metadata.json`

## Inputs

Required:

```json
{
  "videoPath": "./output/example-run/output.mp4"
}
```

Optional fields:

- `outputDir`: directory for report artifacts; defaults next to the video.
- `expectedWidth` and `expectedHeight`: default to `1080` and `1920`.
- `expectAudio`: emit `missing-audio` when no audio stream exists, default `true`.
- `expectCaptions`: check bottom caption band sparsity, default `true`.
- `frameSampleCount`: number of frames to sample, default `12`.
- `layoutReportPath`: pass through issues whose codes begin with `layout-`.

## Outputs

The result contains `reportPath`, `report`, `contactSheetPath`,
`contactSheetMetadataPath`, and `contactSheetMetadata`. The report is written to
`video-technical.report.json`.

Preserved issue codes:

- `wrong-resolution`
- `missing-audio`
- `near-silent-audio`
- `white-flash-or-white-frame`
- `black-frame`
- `white-edge-artifact`
- `black-gutter-artifact`
- `low-motion-run`
- `caption-band-sparse`
- `layout-*`

## Interpretation Notes

The visual checks are sampled-frame heuristics. Treat them as triage evidence:
they catch obvious render failures and artifact classes, but they do not replace
watching the source video when a borderline issue matters.

Repo-side runner:

`node --import tsx scripts/harness/video-technical-review.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs video-technical-review`
