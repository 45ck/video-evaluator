---
name: source-media-signals
description: Collect first-pass source media facts, audio silence/energy, shot estimates, representative frame status, and persistent text/caption risk evidence.
---

# Source Media Signals

Use this when an agent needs conservative source-video signals before deeper
review. This skill is intended as an intake layer, not a semantic video
understanding pass.

This skill owns:

- ffprobe facts through the existing media probe
- audio energy and silence signals through `ffmpeg` when available
- coarse shot and scene estimates through `video-shots` when possible
- representative frame evidence status
- persistent text/caption risk evidence from nearby OCR/layout artifacts when present
- deterministic frame/video fallback evidence when OCR/layout artifacts are absent

## Inputs

Required:

```json
{
  "videoPath": "./output/example-run/output.mp4"
}
```

Optional fields:

- `outputDir`: directory for `source-media.signals.json`; defaults next to the video.
- `outputPath`: exact JSON output path.
- `sceneThreshold`: ffmpeg scene-change threshold, default `0.08`.
- `minShotDurationSeconds`: minimum shot duration, default `0.5`.
- `extractRepresentativeFrames`: whether to write `video-shots/shot-*.jpg`,
  default `true`.
- `runAudioSignals`: whether to run ffmpeg audio analysis, default `true`.
- `runVideoShots`: whether to run shot analysis, default `true`.
- `silenceNoiseDb`: silence threshold, default `-35`.
- `silenceMinDurationSeconds`: minimum silence duration, default `0.25`.

## Outputs

The result contains `manifestPath` and `manifest`. The manifest is
`source-media-signals.v1` and writes:

- `ffprobe.status` and normalized media facts
- `audio.status`, volume fields, and silence segments
- `video.status`, shot counts, boundaries, and scene-estimate metadata
- `representativeFrames.status` and frame paths when available
- `textRisk.status`, `riskLevel`, metrics, artifact paths, and bounded evidence items
  for visible source text, caption/bottom text, layout text issues, or deterministic
  frame/video fallback signals.

## Interpretation Notes

Evidence status is part of the output contract. Treat `unavailable`, `failed`,
and `skipped` as abstention signals, not as proof that a risk is absent. When
OCR/layout artifacts are unavailable, `textRisk.evidence` still records fallback
frame/video signals so downstream guards can persist why the text risk decision
was conservative.

Repo-side runner:

`node --import tsx scripts/harness/source-media-signals.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs source-media-signals`
