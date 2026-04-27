---
name: video-shots
description: Extract coarse shot and scene-change segments from a local video, with optional representative frames for each part.
---

# Video Shots

Use this when an agent needs to split a video into reviewable temporal parts
before deeper storyboard or OCR analysis.

This skill owns:

- detecting scene-change boundaries with `ffmpeg`
- writing `video.shots.json`
- optionally extracting one representative frame per shot
- giving downstream tools a reusable list of video parts

## Inputs

Required:

```json
{
  "videoPath": "./output/example-run/output.mp4"
}
```

Optional fields:

- `outputDir`: directory for `video.shots.json`; defaults next to the video.
- `sceneThreshold`: ffmpeg scene-change threshold, default `0.08`.
- `minShotDurationSeconds`: minimum segment duration, default `0.5`.
- `extractRepresentativeFrames`: whether to write `video-shots/shot-*.jpg`,
  default `true`.

## Outputs

The result contains `manifestPath` and `manifest`. The manifest lists each shot
with start/end seconds, duration, boundary type, representative timestamp, and
representative frame path when frames were extracted.

## Sequencing Guidance

Run this before or alongside `storyboard-extract` when you need a coarse map of
the video. Use `storyboard-extract` for selected visual evidence and
`video-shots` for segment boundaries.

## Interpretation Notes

Shot boundaries are heuristic. They are useful for finding parts to inspect,
but they do not prove semantic scene changes or user actions. Fast cuts, fades,
camera movement, and overlays can affect detection.

## Abstention Rules

Do not infer what happened inside a shot from the boundary alone. Inspect the
representative frame, storyboard frames, OCR, timeline evidence, or the source
video before making content claims.

## Failure Modes

The runner requires `ffmpeg` and `ffprobe`. Very static videos may produce one
long shot. Very noisy videos may produce many short shots, which are merged by
`minShotDurationSeconds`.

Repo-side runner:

`node --import tsx scripts/harness/video-shots.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs video-shots`
