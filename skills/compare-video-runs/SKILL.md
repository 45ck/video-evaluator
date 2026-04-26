---
name: compare-video-runs
description: Compare two local video artifact bundles and surface report-status changes, artifact presence changes, and coarse video-level deltas.
---

# Compare Video Runs

Use this when an agent needs a quick regression view across two output
bundles.

This is best for:

- before/after demo runs
- alternate edit passes
- comparing the latest run against a known-good bundle

Repo-side runner:

`node --import tsx scripts/harness/compare-bundles.ts`
