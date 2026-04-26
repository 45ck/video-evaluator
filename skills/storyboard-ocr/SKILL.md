---
name: storyboard-ocr
description: OCR extracted storyboard frames, write a text manifest, and surface evidence-backed UI text from a local video.
---

# Storyboard OCR

Use this after `storyboard-extract` when an agent needs machine-readable
UI text from extracted frames instead of only images.

This skill owns:

- OCR over extracted storyboard frames
- per-frame text with confidence filtering
- per-line boxes and coarse regions when block/layout OCR is available
- `storyboard.ocr.json`
- an aggregated unique-text summary for later review prompts

Repo-side runner:

`node --import tsx scripts/harness/storyboard-ocr.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-ocr`
