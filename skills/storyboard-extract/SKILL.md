---
name: storyboard-extract
description: Extract storyboard frames from a local video and write a manifest that an agent can inspect as evidence, with optional hybrid sampling around likely changes.
---

# Storyboard Extract

Use this when an agent needs direct visual evidence from a video rather
than only sibling JSON reports.

This skill owns:

- probing video duration with `ffprobe`
- extracting frames with `ffmpeg`
- optional hybrid sampling that biases some frames toward likely scene changes and same-screen local UI updates
- writing `storyboard.manifest.json`
- carrying per-frame sampling reasons into the manifest when available
- giving downstream reviewers stable image artifacts to inspect

## Inputs

Required:

```json
{
  "videoPath": "./output/example-run/output.mp4"
}
```

Optional fields:

- `outputDir`: directory for frame images and `storyboard.manifest.json`;
  defaults to `video-evaluator-storyboard` next to the video.
- `frameCount`: 1 to 24, default `6`.
- `format`: `jpg` or `png`, default `jpg`.
- `samplingMode`: `uniform` or `hybrid`, default `uniform`.
- `changeThreshold`: scene-change threshold for hybrid sampling, default
  `0.08`.

## Outputs

The skill writes frame images and `storyboard.manifest.json`, then returns the
manifest path and manifest. Each frame records index, timestamp, image path, and
sampling reason. Hybrid mode may also include detected change counts,
same-screen candidate diagnostics, nearest change distance, and sampling scores.

## Sequencing Guidance

Use this before `storyboard-ocr`. Prefer `samplingMode: "uniform"` for broad
coverage and deterministic spot checks. Prefer `samplingMode: "hybrid"` when
the video has sparse UI changes or you need evidence near transitions. After
extraction, inspect frames directly when visual fidelity matters, then run OCR
for machine-readable text.

## Interpretation Notes

Sampled frames are evidence, not full coverage. `change-peak` frames were chosen
near detected changes; `coverage-fill` frames preserve spread when change
candidates are sparse. Hybrid diagnostics are heuristics and can miss fades,
subtle animation, or very fast transitions.

## Abstention Rules

Do not claim that unsampled portions of the video are correct. Abstain from text
or accessibility conclusions until `storyboard-ocr` has run or the images have
been manually inspected.

## Failure Modes

The runner requires `ffmpeg` and `ffprobe`. Invalid video paths, unsupported
codecs, zero-duration files, or missing binaries will fail extraction. If hybrid
sampling returns no candidates, the frame plan falls back to uniform coverage.

Repo-side runner:

`node --import tsx scripts/harness/storyboard-extract.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-extract`
