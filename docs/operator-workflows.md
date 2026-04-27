# Operator Workflows

This document gives concrete workflow choices for using `video-evaluator`
without over-claiming what the artifacts prove.

## 1. Fast UI Demo Review

Use this when you have a short app demo and want a quick evidence pass.

```text
storyboard-extract
storyboard-ocr
storyboard-transitions
storyboard-understand
package-review-prompt
```

Inspect:

- `storyboard.manifest.json`
- `storyboard.ocr.json`
- `storyboard.transitions.json`
- `storyboard.summary.json`

Use this when the video is short enough that sampled frames probably cover the
important UI states.

## 2. Shot-Aware Coverage Review

Use this when global sampling skipped too much, `segment.evidence.json` has
empty segments, or the video has many cuts.

```text
video-shots
segment-storyboard
storyboard-ocr
storyboard-transitions
segment-evidence
package-review-prompt
```

Inspect:

- `video.shots.json`
- `segment-storyboard/storyboard.manifest.json`
- `segment-storyboard/storyboard.ocr.json`
- `segment-storyboard/storyboard.transitions.json`
- `segment.evidence.json`

This improves coverage by putting at least one OCR-ready frame inside every
detected shot. It still does not recover continuous motion, clicks, or hidden
source assets.

## 3. Existing Output Bundle Review

Use this when another repo already produced a run folder.

```text
review-bundle
package-review-prompt
```

If the bundle has a primary video but no storyboard artifacts, generate them
with either the fast UI demo workflow or the shot-aware workflow.

## 4. Regression Comparison

Use this when two runs should be compared.

```text
compare-bundles
```

Good comparisons depend on both sides having similar artifact coverage. If one
side has `segment-storyboard/` and the other only has global `storyboard/`,
generate the missing shot-aware artifacts before treating differences as real
product regressions.

## 5. Public Video Benchmarking

Use this to stress the pipeline, not to claim creator-style understanding.

```bash
npm run benchmark:youtube -- --limit=3
```

Read benchmark reports as a boundary test:

- Operational success means tools ran and wrote artifacts.
- Semantic success means artifacts support a specific claim.
- Weak OCR, subtitle dominance, or empty segment evidence should reduce
  confidence even when the process exits successfully.
