---
name: storyboard-understand
description: Turn storyboard OCR into an evidence-backed product summary with likely views, capabilities, and open questions.
---

# Storyboard Understand

Use this after `storyboard-ocr` when an agent needs a first-pass
structured understanding rather than raw OCR lines.

This skill owns:

- app-name guesses from OCR evidence
- likely role/view extraction
- capability claims with cited lines and frame indices
- explicit open questions where inference is still weak

Repo-side runner:

`node --import tsx scripts/harness/storyboard-understand.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-understand`
