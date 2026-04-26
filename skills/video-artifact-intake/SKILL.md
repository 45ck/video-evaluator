---
name: video-artifact-intake
description: Normalize a local video run into a consistent artifact bundle by resolving output roots, latest pointers, known reports, and the primary video path.
---

# Video Artifact Intake

Use this when an agent needs to understand what a repo produced before
reviewing or comparing it.

This skill owns:

- resolving `latest.json` or `LATEST.txt`
- finding `quality.json`, `verification.json`, `validate.json`,
  `score.json`, `publish.json`, and other common artifacts
- locating the main MP4/WebM artifact
- probing the video with `ffprobe` when available

Repo-side runner:

`node --import tsx scripts/harness/video-intake.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs video-artifact-intake`
