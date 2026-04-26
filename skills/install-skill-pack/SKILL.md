---
name: install-skill-pack
description: Materialize the local video-evaluator skill pack into another repo so Codex or Claude Code can use the shared review skills there.
---

# Install Skill Pack

Use this when another repo should consume the local skill pack instead
of re-implementing review helpers.

Outputs:

- copied `skills/*`
- optional `agent/run-tool.mjs`

Repo-side runner:

`node --import tsx scripts/harness/install-skill-pack.ts`
