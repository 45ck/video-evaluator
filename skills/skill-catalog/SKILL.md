---
name: skill-catalog
description: List the shipped video-evaluator skills so an agent can discover the shared review and artifact-intake surface.
---

# Skill Catalog

Use this when an agent needs to discover the shipped capabilities in
`video-evaluator` before choosing a narrower tool.

## Inputs

Pass an empty JSON object:

```json
{}
```

The runner reads JSON from stdin and returns JSON on stdout.

## Outputs

The result lists each shipped skill with its name, description, example request
path, and local runner hints. Treat the catalog as discovery metadata, not as a
review result.

## Sequencing Guidance

Run this first when you are dropped into an unfamiliar repo or an installed
`.video-evaluator` pack and do not know which narrower skill is appropriate.
After catalog discovery, choose the smallest skill that answers the task:

- Use `video-artifact-intake` to map a run directory before reviewing it.
- Use `review-bundle` for a fast status summary of one run.
- Use `storyboard-extract`, `storyboard-ocr`, `storyboard-transitions`, and
  `storyboard-understand` in that order for visual evidence.
- Use `compare-video-runs` only when two bundles are available.
- Use `package-review-prompt` when another agent needs a grounded prompt.

## Abstention Rules

Do not run this repeatedly once you already know the needed skill. Do not use it
as proof that artifacts exist; it only describes available capabilities.

## Failure Modes

If the catalog runner is missing, the skill pack may not be installed correctly.
Use the repo-side runner from the source checkout, or run `install-skill-pack`
from the source repo if you need to materialize the pack elsewhere.

Repo-side runner:

`node --import tsx scripts/harness/skill-catalog.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs skill-catalog`
