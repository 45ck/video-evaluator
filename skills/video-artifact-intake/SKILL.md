---
name: video-artifact-intake
description: Normalize a local video run into a consistent artifact bundle by resolving output roots, latest pointers, known reports, and the primary video path.
---

# Video Artifact Intake

Use this when an agent needs to understand what a repo produced before
reviewing or comparing it.

This skill owns:

- resolving `latest.json` or `LATEST.txt`
- finding `quality.json`, `verification.json`, `validate.json`,
  `score.json`, `publish.json`, and other common artifacts
- locating the main MP4/WebM artifact
- probing the video with `ffprobe` when available

## Inputs

Provide one or more bundle locators:

```json
{
  "outputDir": "./output/example-run",
  "latestPointerRoot": "./output",
  "videoPath": "./output/example-run/output.mp4"
}
```

Use `outputDir` when you already know the run directory. Use
`latestPointerRoot` when the repo maintains `latest.json` or `LATEST.txt`. Use
`videoPath` when the video is outside the normal output directory. Paths may be
relative to the current working directory.

## Outputs

The result is a normalized bundle map with:

- `rootDir`: resolved run directory, or `null` if only a standalone video was
  provided.
- `videoPath`: primary video path if found.
- `artifacts`: known reports and files found under the root.
- `reportStatuses`: derived status for JSON reports with `status`, `passed`, or
  `hasFailures` fields.
- `overallStatus`: `pass`, `warn`, `fail`, or `unknown`.
- `recommendedFocus`: artifact-driven review areas.
- `videoProbe`: duration, dimensions, codec, and size when `ffprobe` succeeds.
- `timeline.evidence.json`: generated when `timestamps.json`, `events.json`,
  or `subtitles.vtt` exists in the bundle.

## Sequencing Guidance

Run this before `review-bundle`, `package-review-prompt`, or
`compare-video-runs` if you are unsure which directory or video should be
reviewed. If storyboard artifacts are missing but a video is present, continue
with `storyboard-extract`.

When `timeline.evidence.json` is present, inspect it before making sequence,
caption, transcript, or action-timing claims.

## Interpretation Notes

`overallStatus: unknown` usually means no recognizable JSON status reports were
found; it is not a pass. `reportStatuses` are shallow summaries and do not
replace reading the source reports when they warn or fail. `videoProbe` is
optional because `ffprobe` may be unavailable or unable to parse the file.

## Abstention Rules

Do not infer product behavior, UI quality, or correctness from intake alone.
Abstain from quality judgments if the only evidence is a discovered video path
and no review reports or storyboard artifacts.

## Failure Modes

Missing or stale latest pointers can resolve the wrong run. If no video is
found, check whether the repo uses nonstandard filenames and pass `videoPath`
explicitly. If `ffprobe` is missing, the bundle can still be mapped but video
metadata will be absent.

Repo-side runner:

`node --import tsx scripts/harness/video-intake.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs video-artifact-intake`
