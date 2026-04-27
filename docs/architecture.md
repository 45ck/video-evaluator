# Architecture

`video-evaluator` is a standalone skill pack and TypeScript runtime for turning
videos or run folders into grounded review artifacts.

It has four layers:

1. Skills under `skills/` describe agent-facing tasks.
2. Harness entrypoints under `scripts/harness/` expose local JSON-stdio tools.
3. Runtime code under `src/` implements extraction, OCR, transitions,
   summaries, comparisons, and prompt packaging.
4. Artifacts on disk provide the review contract between this pack and the
   calling agent or repo.

The architecture is intentionally file-oriented. A caller should be able to
inspect intermediate JSON files and decide whether a conclusion is supported by
real evidence.

## Runtime Surfaces

The repo can be used in three ways:

- Local scripts: `node --import tsx scripts/harness/<tool>.ts`
- Installed skill pack: `agent/run-tool.mjs <tool>` inside a materialized pack
- TypeScript dependency: imports from `src/index.ts` after build

All tool requests are JSON objects validated by schemas in the runtime. The
harnesses return JSON responses so agents can call them without scraping logs.

## Tool Flow

The common review flow is:

```text
video-intake / review-bundle
  -> storyboard-extract
  -> video-shots
  -> storyboard-ocr
  -> storyboard-transitions
  -> segment-evidence
  -> storyboard-understand
  -> package-review-prompt / compare-bundles
```

`video-intake` normalizes either a direct video path or an existing output
folder. `review-bundle` is the review-oriented wrapper for existing bundles.

`storyboard-extract` samples frames from a source video. Uniform sampling gives
a simple timeline backbone. Hybrid sampling keeps that backbone and adds frames
near likely visual changes.

`video-shots` uses scene-change detection to produce a coarse list of shot
segments plus optional representative frames. It is useful for dividing longer
videos into inspectable parts before deeper OCR or semantic review.

`storyboard-ocr` runs OCR over extracted frames. It writes raw OCR lines,
filtered semantic lines, confidence data, bounding boxes, coarse screen regions,
and per-frame quality status.

`storyboard-transitions` compares adjacent OCR/frame evidence and assigns coarse
transition kinds such as `screen-change`, `state-change`, `scroll-change`,
`dialog-change`, or `uncertain`.

`segment-evidence` fuses shot boundaries with available storyboard frames, OCR,
transitions, and timeline items. It writes one segment record per shot and marks
each segment as `usable`, `weak`, or `empty` based on available evidence.

`storyboard-understand` builds an agent-facing summary from OCR and transition
artifacts. It may identify app names, views, likely flow, likely capabilities,
text dominance, OCR quality, and open questions.

`video-intake` also normalizes existing timeline-like producer artifacts into
`timeline.evidence.json` when `timestamps.json`, `events.json`, or
`subtitles.vtt` are present.

`package-review-prompt` creates a grounded review prompt from the artifacts.
`compare-bundles` compares two video-output bundles or runs.

## Artifact Contract

The detailed compatibility document is
[artifact-contracts.md](./artifact-contracts.md).

The main artifacts are:

- `storyboard.manifest.json`: extracted frames, timestamps, sampling reasons,
  and extraction diagnostics.
- `storyboard.ocr.json`: OCR lines, filtered semantic UI evidence, confidence,
  regions, and frame-level quality.
- `storyboard.transitions.json`: coarse frame-to-frame changes and supporting
  evidence.
- `storyboard.summary.json`: higher-level interpretation for agents, including
  quality and uncertainty fields.
- `timeline.evidence.json`: timestamped transcript, caption, and action
  evidence normalized from producer artifacts.
- `video.shots.json`: coarse scene-change segments and optional representative
  frame paths.
- `segment.evidence.json`: per-shot evidence map that joins visual, OCR,
  transition, and timeline artifacts.

Downstream agents should cite or reason from these artifacts. If an artifact is
missing, low-signal, or internally inconsistent, the caller should treat the
review as incomplete rather than fill the gap with speculation.

## Evidence Boundaries

The system is strongest when visual frames contain stable UI labels, menus,
dialogs, button text, and view titles. It is weaker when frames are dominated by
subtitles, narration text, overlays, motion blur, small fonts, low contrast, or
non-UI footage.

Important distinction:

- Operational success means the pipeline ran and wrote artifacts.
- Semantic success means the artifacts contain enough signal to support useful
  claims.

The architecture keeps these separate through OCR quality, text dominance, open
questions, and benchmark metrics.

## Skill Pack Installation

`install-skill-pack` materializes the built runtime, skills, runner, and needed
runtime files into a target directory. The installed pack is meant to be copied
into other workspaces without requiring those workspaces to understand this repo
layout.

After installation, tools are normally invoked through:

```bash
node ./.video-evaluator/agent/run-tool.mjs package-review-prompt
```

with a JSON request on stdin.

## Maintenance Implications

Because this is a reusable skill pack, compatibility matters at the artifact and
tool-request level. Changes that rename fields, remove artifacts, or alter
meaningful quality gates can break callers even if TypeScript still compiles.

Maintain the following invariants:

- Keep JSON request and response shapes explicit.
- Keep low-signal and abstention behavior visible.
- Do not conflate benchmark completion with semantic understanding.
- Preserve an inspectable artifact path for every review conclusion.
- Update docs and tests when artifact meaning changes.
