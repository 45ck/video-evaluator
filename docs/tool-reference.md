# Tool Reference

This document is the operator-facing map of the `video-evaluator` tool surface.
Use it when you know the artifact you want but do not remember which runner
produces it.

Every local runner accepts one JSON object on stdin:

```bash
cat <<'JSON' | node --import tsx scripts/harness/<tool>.ts
{
  "outputDir": "./output/example"
}
JSON
```

Installed packs use the same request body through:

```bash
cat <<'JSON' | node ./.video-evaluator/agent/run-tool.mjs <tool>
{
  "outputDir": "./output/example"
}
JSON
```

## Discovery And Installation

| Tool                 | Purpose                                                       | Main Output                        |
| -------------------- | ------------------------------------------------------------- | ---------------------------------- |
| `skill-catalog`      | List shipped skills and their docs.                           | JSON skill list                    |
| `install-skill-pack` | Copy the built runtime, skills, and runner into another repo. | installed `.video-evaluator/` pack |

## Intake And Review Packaging

| Tool                    | Purpose                                                                                        | Main Output                 |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| `analyze-video`         | Orchestrate media probe, quality gates, caption artifacts, and technical review for one video. | `analyzer.report.json`      |
| `analyze-bundle`        | Resolve an existing output bundle, package bundle evidence, and run the video analyzer.        | `analyzer.report.json`      |
| `video-intake`          | Normalize a video path or existing output folder into a known bundle shape.                    | bundle artifact map         |
| `source-media-signals`  | Probe source media and emit conservative audio, scene, frame, and text-risk evidence status.   | `source-media.signals.json` |
| `review-bundle`         | Inspect an existing bundle and report what review evidence exists.                             | review report               |
| `package-review-prompt` | Build an evidence-grounded prompt for a coding agent.                                          | packaged prompt             |
| `compare-bundles`       | Compare two output folders or video runs.                                                      | comparison report           |

## Visual Evidence

| Tool                 | Purpose                                                            | Main Output                                   |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `storyboard-extract` | Extract uniform or hybrid sampled frames from a video.             | `storyboard.manifest.json`                    |
| `video-shots`        | Detect coarse shot boundaries and optional representative frames.  | `video.shots.json`                            |
| `segment-storyboard` | Extract one to three storyboard frames inside every detected shot. | `segment-storyboard/storyboard.manifest.json` |

`storyboard-extract` is the fastest way to get a visual overview.
`segment-storyboard` is the better choice after `video-shots` when review needs
coverage across all detected segments.

`source-media-signals` is a first-pass intake signal collector. It writes
ffprobe facts, ffmpeg audio volume/silence when available, `video-shots` scene
estimates when possible, representative frame evidence status, and a placeholder
text-risk status without claiming OCR evidence.

## OCR, Transitions, And Summaries

| Tool                     | Purpose                                                                                          | Main Output                    |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `storyboard-ocr`         | OCR storyboard frames and classify OCR quality.                                                  | `storyboard.ocr.json`          |
| `storyboard-transitions` | Infer coarse frame-to-frame change types.                                                        | `storyboard.transitions.json`  |
| `storyboard-understand`  | Summarize likely apps, views, flow, and open questions.                                          | `storyboard.summary.json`      |
| `layout-safety-review`   | Detect declared layout overlaps, caption safe-zone collisions, and OCR text collisions.          | `layout-safety.report.json`    |
| `video-technical-review` | Detect resolution, audio, frame, edge, low-motion, caption-band, and layout pass-through issues. | `video-technical.report.json`  |
| `golden-frame-compare`   | Compare one current PNG frame against a baseline PNG frame, or update the baseline.              | `golden-frame.diff.json`       |
| `demo-visual-review`     | Compare current demo PNG frames against baseline frames by explicit list or directory.           | `demo-visual-review.diff.json` |
| `segment-evidence`       | Fuse shot, storyboard, OCR, transition, and timeline artifacts by shot.                          | `segment.evidence.json`        |

Run OCR and transitions against `segment-storyboard/` when that folder exists
and segment-level coverage matters. Bundle intake prefers `segment-storyboard/`
over `storyboard/` when both contain storyboard artifacts.

## Common Sequences

Minimal storyboard review:

```text
storyboard-extract -> storyboard-ocr -> storyboard-transitions -> storyboard-understand
```

Shot-aware review:

```text
video-shots -> segment-storyboard -> storyboard-ocr -> storyboard-transitions -> segment-evidence
```

Existing run review:

```text
analyze-bundle -> package-review-prompt
```

For cross-repo handoff, keep `analyzer.report.json`, `media-probe.json`,
`quality-gates.json`, `caption-artifact.json`, and
`demo-capture-evidence.json` at the bundle root when those capabilities ran.
`package-review-prompt` treats these as first-class review reports so
downstream agents inspect shared analyzer evidence before repo-specific
artifacts. It also summarizes `quality.json`, visual diffs, legacy
`visual-diff-report.json`, screenshot evidence, caption risk, timeline
evidence, and layout-safety issues when those artifacts exist, then names the
first artifact a reviewer should inspect next.

Known producer integrations:

- `demo-machine analyze <output-dir>` writes evaluator artifacts beside a
  completed demo run, then its quality gate can fold analyzer findings back
  into `quality.json`.
- `content-machine` demo audits use evaluator layout-safety and technical
  evidence for promoted short-form examples while keeping generation and
  archetype policy in the skill pack.

Golden-frame review:

```text
golden-frame-compare
demo-visual-review
```

Before/after review:

```text
compare-bundles
```

## Interpretation Rules

- Treat generated JSON as evidence, not ground truth.
- Use `quality.status`, `textDominance`, and `openQuestions` before making
  semantic claims.
- Treat `empty` or `weak` segment evidence as an abstention signal.
- Do not claim arbitrary video understanding from operational success alone.
