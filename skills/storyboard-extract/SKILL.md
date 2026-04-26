---
name: storyboard-extract
description: Extract storyboard frames from a local video and write a manifest that an agent can inspect as evidence, with optional hybrid sampling around likely changes.
---

# Storyboard Extract

Use this when an agent needs direct visual evidence from a video rather
than only sibling JSON reports.

This skill owns:

- probing video duration with `ffprobe`
- extracting frames with `ffmpeg`
- optional hybrid sampling that biases some frames toward likely scene changes
- writing `storyboard.manifest.json`
- giving downstream reviewers stable image artifacts to inspect

Repo-side runner:

`node --import tsx scripts/harness/storyboard-extract.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs storyboard-extract`
