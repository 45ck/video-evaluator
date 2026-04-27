# Changelog

All notable changes to this repo will be documented here.

## Unreleased

- Added `timeline.evidence.json` generation from `timestamps.json`,
  `events.json`, and `subtitles.vtt` during bundle intake.
- Added timeline evidence previews to packaged review prompts.
- Fixed direct `packageReviewPrompt()` calls to apply schema defaults before
  building prompts.

## v0.1.1 - 2026-04-27

- Added operator docs for architecture, artifact contracts, YouTube evaluation,
  release process, roadmap, and support.
- Expanded repo-local skill docs with sequencing, inputs, outputs, failure
  modes, interpretation guidance, and abstention rules.
- Added optional YouTube benchmark gate flags for operational success,
  negative-control false positives, and gold high-fit semantic passes.
- Included docs, support files, visual assets, and benchmark manifests in the
  npm package and installed skill pack.

## v0.1.0 - 2026-04-26

Initial standalone public release.

Highlights:

- storyboard extraction with hybrid sampling
- OCR artifact generation with filtered semantic UI evidence
- frame-level OCR quality gating
- coarse transition inference and summary artifacts
- installable Codex / Claude Code skill pack
- public YouTube benchmark harness with explicit low-signal reporting
