---
name: storyboard-transitions
description: Infer frame-to-frame transitions from storyboard image diffs and OCR deltas, then write an evidence-backed transition manifest.
---

# Storyboard Transitions

Use this after `storyboard-ocr` when an agent needs sequence-level
change evidence instead of isolated sampled frames.

This skill owns:

- image-level diff between adjacent storyboard frames
- OCR text additions and removals
- coarse transition kinds such as `screen-change` or `state-change`
- overlap/shared-line signals for same-screen heuristics
- heuristic transition labels with confidence
- `storyboard.transitions.json`

Repo-side runner:

`node --import tsx scripts/harness/storyboard-transitions.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-transitions`
