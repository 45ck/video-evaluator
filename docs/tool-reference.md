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

| Tool                    | Purpose                                                                     | Main Output         |
| ----------------------- | --------------------------------------------------------------------------- | ------------------- |
| `video-intake`          | Normalize a video path or existing output folder into a known bundle shape. | bundle artifact map |
| `review-bundle`         | Inspect an existing bundle and report what review evidence exists.          | review report       |
| `package-review-prompt` | Build an evidence-grounded prompt for a coding agent.                       | packaged prompt     |
| `compare-bundles`       | Compare two output folders or video runs.                                   | comparison report   |

## Visual Evidence

| Tool                 | Purpose                                                            | Main Output                                   |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `storyboard-extract` | Extract uniform or hybrid sampled frames from a video.             | `storyboard.manifest.json`                    |
| `video-shots`        | Detect coarse shot boundaries and optional representative frames.  | `video.shots.json`                            |
| `segment-storyboard` | Extract one to three storyboard frames inside every detected shot. | `segment-storyboard/storyboard.manifest.json` |

`storyboard-extract` is the fastest way to get a visual overview.
`segment-storyboard` is the better choice after `video-shots` when review needs
coverage across all detected segments.

## OCR, Transitions, And Summaries

| Tool                     | Purpose                                                                                 | Main Output                   |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------------------- |
| `storyboard-ocr`         | OCR storyboard frames and classify OCR quality.                                         | `storyboard.ocr.json`         |
| `storyboard-transitions` | Infer coarse frame-to-frame change types.                                               | `storyboard.transitions.json` |
| `storyboard-understand`  | Summarize likely apps, views, flow, and open questions.                                 | `storyboard.summary.json`     |
| `layout-safety-review`   | Detect declared layout overlaps, caption safe-zone collisions, and OCR text collisions. | `layout-safety.report.json`   |
| `segment-evidence`       | Fuse shot, storyboard, OCR, transition, and timeline artifacts by shot.                 | `segment.evidence.json`       |

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
review-bundle -> package-review-prompt
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
