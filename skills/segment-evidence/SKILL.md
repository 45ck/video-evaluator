---
name: segment-evidence
description: Fuse video shot segments with storyboard frames, OCR, transitions, and timeline artifacts into one per-segment evidence map for grounded video review.
---

# Segment Evidence

Use this after `video-shots` when a reviewer needs one ordered map of what
evidence exists for each video part.

This skill owns:

- reading `video.shots.json`
- attaching overlapping storyboard frames
- attaching OCR text evidence and OCR quality counts
- attaching overlapping transition and timeline evidence
- writing `segment.evidence.json`

## Inputs

Use the same bundle locators as `video-artifact-intake`:

```json
{
  "outputDir": "./output/example-run",
  "maxTextItemsPerSegment": 8
}
```

`maxTextItemsPerSegment` defaults to `8`. `outputPath` is optional if the
artifact should be written somewhere other than `segment.evidence.json`.

## Outputs

The result contains `manifestPath` and `manifest`. The manifest has one segment
per shot, with:

- segment start/end times
- representative shot frame path when available
- overlapping storyboard frames
- overlapping timeline items
- overlapping transitions
- text evidence from OCR and timeline artifacts
- `evidenceStatus`: `usable`, `weak`, or `empty`

## Sequencing Guidance

Run `video-shots` first. Run `storyboard-extract`, `storyboard-ocr`,
`storyboard-transitions`, and timeline-producing tools first if you want richer
segment evidence. The tool can still run with only `video.shots.json`, but most
segments will be `weak` or `empty`.

## Interpretation Notes

`segment.evidence.json` is an evidence router. It says which artifacts support
each segment. It does not prove full semantic understanding by itself.

Treat `empty` as an abstention signal. Treat `weak` as a request to inspect the
representative frame or source video before making claims.

Repo-side runner:

`node --import tsx scripts/harness/segment-evidence.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs segment-evidence`
