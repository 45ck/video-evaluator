# video-evaluator

Shared video evaluation and understanding skill pack for coding-agent
workflows.

This repo is a standalone evaluation pack that is meant to be proven
useful before other repos depend on it. It does not replace
domain-specific generation or QA pipelines. It owns the generic pieces:

- artifact-bundle intake
- latest-run discovery
- storyboard frame extraction
- hybrid storyboard sampling that can bias frames toward likely scene/change points
- region-aware probe scoring for same-screen local UI changes
- OCR over extracted storyboard frames
- heuristic storyboard understanding from OCR evidence
- frame-to-frame transition inference from image diffs and OCR/layout deltas
- report/status normalization
- review prompt packaging
- bundle-to-bundle comparison
- installable Codex/Claude Code skills

The current shape is intentionally narrow. It helps agents understand
what a video run produced and how to review it, without pretending one
generic scorer can replace domain-specific checks.

Current boundary:

- good at evidence extraction for UI-heavy product videos
- good at turning artifacts into grounded review prompts
- decent at first-pass OCR-backed product understanding
- now preserves per-line OCR boxes/regions when the OCR engine exposes them
- now emits coarse transition kinds such as `screen-change` alongside flow labels
- now extracts broader app/view/capability hints instead of only one hard-coded demo shape
- now carries frame-level sampling reasons through extraction, OCR, and summary artifacts
- still weak at full-sequence action reconstruction
- still heuristic, not deep multimodal video understanding

## Shipped Tools

- `skill-catalog`
- `install-skill-pack`
- `video-intake`
- `review-bundle`
- `storyboard-extract`
- `storyboard-ocr`
- `storyboard-understand`
- `storyboard-transitions`
- `compare-bundles`
- `package-review-prompt`

## Local Use

Prerequisites:

- Node.js `>=20.6.0`
- `ffmpeg` and `ffprobe` on `PATH`
- bundled `eng.traineddata` or network access for `tesseract.js` to
  fetch language data on first use

```bash
npm install
npm run build
npm test
```

Review a bundle:

```bash
cat <<'JSON' | node --import tsx scripts/harness/review-bundle.ts
{
  "outputDir": "../demo-machine/output/todo-app/20260426-000000-000"
}
JSON
```

Extract storyboard frames from a raw video:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-extract.ts
{
  "videoPath": "/path/to/video.mp4",
  "frameCount": 6,
  "samplingMode": "hybrid"
}
JSON
```

`samplingMode: "hybrid"` keeps the uniform backbone but uses ffmpeg
scene-change detection plus a region-aware probe to bias some frames
toward likely transitions and same-screen local UI changes. This is
still heuristic, but it gives the OCR/transition layers denser evidence
around UI changes than pure even spacing.

The storyboard manifest now includes per-frame `samplingReason` and
`nearestChangeDistanceSeconds` when that evidence is available.

OCR extracted storyboard frames:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-ocr.ts
{
  "storyboardDir": "./output/storyboard"
}
JSON
```

The OCR artifact now attempts to preserve:

- per-line confidence
- per-line bounding boxes
- coarse `top` / `middle` / `bottom` regions

when the OCR engine exposes block/layout data.

Generate an evidence-backed storyboard summary:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-understand.ts
{
  "storyboardDir": "./output/storyboard"
}
JSON
```

The summary artifact now includes a `sampling` section so downstream
agents can see whether the evidence came from uniform or hybrid
sampling, how many change-biased frames were selected, and whether the
artifact predates frame-level sampling annotations.

Infer transitions between storyboard frames:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-transitions.ts
{
  "storyboardDir": "./output/storyboard"
}
JSON
```

The transitions artifact now includes:

- `transitionKind`
- `overlapRatio`
- `sharedLineCount`
- OCR-derived evidence strings

Run the mixed public-video benchmark:

```bash
npm run benchmark:youtube -- --limit=3
```

Useful flags:

- `--manifest=benchmarks/youtube-diverse-queries.json`
- `--output-root=/tmp/video-evaluator-youtube-benchmark`
- `--limit=10`
- `--frame-count=8`
- `--clip-seconds=75`
- `--change-threshold=0.08`
- `--min-confidence=45`

The benchmark resolves each query with `yt-dlp`, downloads a public
sample, clips it, runs storyboard extraction/OCR/transitions/summary,
and writes:

- per-case `case-report.json`
- aggregate `benchmark.report.json`
- human-readable `benchmark.report.md`

The aggregate benchmark report distinguishes raw flow recovery from
meaningful flow recovery. Cases that only produce generic
`screen-change` transitions are still recorded, but they are not counted
as meaningful interaction/flow success.

Manifest entries can set `startSeconds` to skip title-card/introduction
sections and target the real product segment of a video.

For stable benchmarks, prefer pinning `videoId` plus optional
`channelContains` / `titleContains` in the manifest. Query-only entries
are useful for exploration, but they should be treated as provisional
because live YouTube ranking can drift.

If the machine has an old global `yt-dlp`, the benchmark will bootstrap
a newer copy into its output tooling directory and prefer Firefox
cookies when available.

This is intended to expose capability boundaries across very different
video shapes, not to claim that the pack can fully decompile arbitrary
videos yet.

Install the skill pack into another repo:

```bash
cat <<'JSON' | node --import tsx scripts/harness/install-skill-pack.ts
{
  "targetDir": ".video-evaluator"
}
JSON
```

`install-skill-pack` expects an existing local build. It copies
`dist/`, `skills/`, `agent/run-tool.mjs`, `eng.traineddata`, and the
package metadata into the target folder, then installs runtime
dependencies there by default.

## Agent Surface

Materialized-pack consumers should prefer:

```bash
cat <<'JSON' | node ./.video-evaluator/agent/run-tool.mjs package-review-prompt
{
  "outputDir": "./output/storyboard",
  "focus": ["what the app appears to do", "flow progression"]
}
JSON
```

If you install from npm instead of copying the local pack:

```bash
cat <<'JSON' | node ./node_modules/@45ck/video-evaluator/agent/run-tool.mjs review-bundle
{
  "outputDir": "./output"
}
JSON
```

## Direction

Short term:

- stabilize a common artifact contract
- keep video review prompts and summaries consistent across repos
- give Codex and Claude Code a shared skill surface
- keep capability claims honest while the sequence layer is still
  heuristic

Later:

- denser sampling around scene changes
- stronger same-screen, dialog, and scroll inference from OCR/layout anchors
- richer timeline/event understanding
- repo-specific adapters that plug into the shared bundle contract
