---
name: package-review-prompt
description: Assemble a grounded review prompt from a local artifact bundle so Codex or Claude Code can inspect the right files and ask the right questions.
---

# Package Review Prompt

Use this when you want a reviewer agent to sound grounded in the real
run artifacts rather than hallucinating the review surface.

This skill produces:

- bundle summary
- artifact-aware prompt text
- explicit review focus areas

Repo-side runner:

`node --import tsx scripts/harness/package-review-prompt.ts`
