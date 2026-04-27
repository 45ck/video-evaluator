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

## Inputs

Provide either the storyboard directory or manifest path:

```json
{
  "storyboardDir": "./output/storyboard",
  "minConfidence": 45
}
```

```json
{
  "manifestPath": "./output/storyboard/storyboard.manifest.json",
  "minConfidence": 55
}
```

`minConfidence` defaults to `45` and must be between 0 and 100.

## Outputs

The skill writes `storyboard.ocr.json` beside the storyboard manifest. The
manifest includes per-frame OCR lines, semantic UI-like lines, confidence,
regions, optional bounding boxes, frame quality, unique text summaries, and
sampling metadata carried forward from extraction.

## Sequencing Guidance

Run after `storyboard-extract`. Run before `storyboard-transitions` and
`storyboard-understand`. If OCR quality is weak but the visual frames look
important, manually inspect the images instead of relying only on text output.

## Interpretation Notes

Use `semanticLines` for product/UI claims; raw `lines` may include subtitles,
decorative text, or OCR noise. `quality.status: reject` means downstream text
inference should be low-trust for that frame. Bottom-region long sentences are
often classified as subtitle-like and suppressed from semantic summaries.

## Abstention Rules

Do not treat OCR text as exact transcription unless confidence and frame
quality are strong. Abstain from naming features, screens, or workflows if the
supporting lines are low-confidence, suppressed, or only present in rejected
frames.

## Failure Modes

The input must point to an existing storyboard manifest and image files.
Tesseract/OCR setup failures, missing frames, unreadable images, or an overly
high `minConfidence` can produce sparse output. Sparse output is a signal to
inspect the frame images, not a signal that the UI contains no text.

Repo-side runner:

`node --import tsx scripts/harness/storyboard-ocr.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-ocr`
