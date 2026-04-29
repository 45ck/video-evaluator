# Canonical Video Analyzer Beads Plan

`video-evaluator` is the canonical home for reusable video analysis shared by
`content-machine`, `demo-machine`, and future agent video repos.

The repo should own evidence extraction, analyzer contracts, media probes,
caption/layout/quality reports, visual diffs, review bundles, and packaged
review prompts. Consumer repos should keep product-specific policy, generation
logic, and compatibility wrappers.

## Beads Status

Beads was initialized in this repo on 2026-04-29 with prefix
`video-evaluator`.

Primary issue graph:

| ID | Priority | Title |
| --- | --- | --- |
| `video-evaluator-i7u` | P0 | Make video-evaluator the canonical shared video analyzer |
| `video-evaluator-aqn` | P0 | Define canonical analyzer contracts and package boundaries |
| `video-evaluator-tgy` | P0 | Add analyze-video and analyze-bundle orchestrators |
| `video-evaluator-9h7` | P0 | Add media probe and render-quality gates |
| `video-evaluator-b7i` | P0 | Port technical signal analyzers from content-machine |
| `video-evaluator-7nb` | P0 | Add continuous caption OCR quality and sync evaluators |
| `video-evaluator-lkp` | P1 | Add source media signals and source text guard |
| `video-evaluator-ix9` | P1 | Add video technical review and contact-sheet tool |
| `video-evaluator-ojx` | P1 | Add demo-machine capture, visual diff, and golden-frame gates |
| `video-evaluator-893` | P1 | Extend package review prompt and layout safety skill docs |
| `video-evaluator-v6a` | P1 | Add cross-repo compatibility fixtures and snapshots |

Run:

```bash
npm_config_script_shell=/bin/bash npx --yes @beads/bd ready
npm_config_script_shell=/bin/bash npx --yes @beads/bd graph
```

## Dependency Shape

```text
contracts
  -> analyze-video/analyze-bundle
  -> media probe/render-quality gates
      -> technical signal analyzers
      -> caption OCR/sync evaluators
      -> source media signals
      -> demo visual/golden-frame gates
  -> review prompt + layout-safety skill docs
  -> cross-repo compatibility fixtures
```

## Boundary

Move into `video-evaluator`:

- FFprobe/media facts, dimensions, codecs, pixel format, audio/video duration,
  frame rate, file size, and audio presence.
- Scene/cadence, freeze, black/white frames, edge/gutter artifacts, temporal
  quality, audio signal, and optical-flow artifact checks.
- Continuous caption OCR, caption readability, caption placement, safe-zone,
  jitter/flicker, OCR-vs-expected, and OCR-vs-ASR sync metrics.
- Source media audit, text guard, representative frames, silence/audio energy,
  scene changes, and source-use recommendation.
- Demo-machine visual diff, golden-frame comparison, screenshot evidence,
  cursor/target evidence, and review prompt packaging.

Keep out of `video-evaluator`:

- `content-machine` short-generation decisions, archetype scoring, Remotion
  render policy, and publish metadata.
- `demo-machine` playback/capture semantics, selector correctness, narration
  before action, and product-specific quality policy.
