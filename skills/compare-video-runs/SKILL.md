---
name: compare-video-runs
description: Compare two local video artifact bundles and surface report-status changes, artifact presence changes, and coarse video-level deltas.
---

# Compare Video Runs

Use this when an agent needs a quick regression view across two output
bundles.

This is best for:

- before/after demo runs
- alternate edit passes
- comparing the latest run against a known-good bundle

## Inputs

Provide two bundle locators using the same shape accepted by
`video-artifact-intake`:

```json
{
  "left": {
    "outputDir": "./output/baseline-run"
  },
  "right": {
    "outputDir": "./output/current-run"
  }
}
```

Use `left` for the baseline or expected-good run and `right` for the candidate
run.

## Outputs

The result compares normalized bundle maps: overall status changes, artifact
presence changes, report status changes, and coarse video metadata deltas when
both sides can be probed.

## Sequencing Guidance

Run `video-artifact-intake` first if either side is ambiguous. Use
`review-bundle` on the candidate side when the comparison finds warnings or
failures. Use storyboard skills on both sides only when visual regressions need
evidence beyond report/status deltas.

## Interpretation Notes

The comparison is only as strong as the artifacts present in both bundles. A
missing report on the right may indicate a regression in generation, a changed
pipeline, or a different output directory. Video duration/resolution deltas are
coarse signals; inspect the videos or storyboard frames for behavioral changes.

## Abstention Rules

Do not call a run better solely because it has fewer reports or an `unknown`
status. Abstain from visual regression conclusions unless both runs have
comparable video/storyboard evidence.

## Failure Modes

If left and right point to the same directory, the comparison will be
meaningless. Stale latest pointers can compare the wrong run. Missing `ffprobe`
removes video metadata deltas but should not block artifact comparison.

Repo-side runner:

`node --import tsx scripts/harness/compare-bundles.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs compare-video-runs`
