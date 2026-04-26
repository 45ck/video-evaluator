---
name: review-bundle
description: Review a local video artifact bundle, summarize report status across known artifacts, and point the agent at the first useful review surfaces.
---

# Review Bundle

Use this when a repo already produced a run and the agent needs the
shared review layer rather than repo-specific generation logic.

This skill does not replace domain-specific QA. It tells the agent:

- what artifacts exist
- which reports passed, warned, or failed
- which surfaces deserve immediate human or agent attention

Repo-side runner:

`node --import tsx scripts/harness/review-bundle.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs review-bundle`
