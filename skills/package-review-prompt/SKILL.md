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

## Inputs

Use the same bundle locators as `video-artifact-intake`, plus optional review
context:

```json
{
  "latestPointerRoot": "./output",
  "specPath": "./specs/demo-review.md",
  "focus": ["caption readability", "failure trace"]
}
```

`focus` defaults to an empty array. `specPath` is optional and should point to a
local spec or brief the reviewer should consider.

## Outputs

The result contains a grounded prompt assembled from discovered artifacts,
recommended focus areas, and optional spec/focus inputs. It is designed to be
handed to Codex or Claude Code for the next review step. When
`timeline.evidence.json` exists, the prompt includes a short timeline preview.
When `video.shots.json` exists, the prompt includes a short shot-structure
preview. When `segment.evidence.json` exists, the prompt includes a short
segment-evidence preview. When canonical analyzer files exist at the bundle
root, such as `analyzer.report.json`, `media-probe.json`, `quality-gates.json`,
or `caption-artifact.json`, the prompt lists them as report evidence so the
reviewer starts from the shared analyzer output.

The prompt also routes common reviewer failure modes:

- `quality-gates.json` failures and warnings, with first timestamped evidence
- `demo-visual-review.diff.json` and `golden-frame.diff.json` mismatch summary
- `demo-capture-evidence.json` screenshot evidence
- `caption-artifact.json` readability or sync risk plus caption-related gates
- `layout-safety.report.json` caption, safe-zone, OCR, and overlap issues
- an explicit suggested first artifact to inspect next

## Sequencing Guidance

Run after `video-artifact-intake` or `review-bundle` if you need to delegate a
review. If storyboard artifacts are needed but absent, run
`storyboard-extract`, `storyboard-ocr`, and optionally
`storyboard-transitions`/`storyboard-understand` before packaging the prompt.

## Interpretation Notes

The generated prompt is a routing aid, not a review verdict. It should point the
next agent at real files and questions. If the bundle is sparse, the prompt
should preserve uncertainty rather than invent missing evidence.

Use timeline evidence to ground ordering, caption, transcript, and action claims
before relying on sparse storyboard frames.

Use shot evidence to choose which video segments or representative frames need
closer inspection. Do not treat shot boundaries as semantic proof by themselves.

Use segment evidence as the fastest routing layer for which parts have usable,
weak, or empty evidence.

## Abstention Rules

Do not use this skill to summarize artifacts you have not generated or found.
Do not ask a reviewer to evaluate claims that are unsupported by the bundle,
unless they are explicitly framed as open questions.

## Failure Modes

Wrong bundle locators produce a grounded prompt for the wrong run. Missing
`specPath` should not fail the run if omitted, but an invalid provided path can
make the prompt incomplete or misleading. If discovered artifacts are sparse,
run intake/storyboard steps first.

Repo-side runner:

`node --import tsx scripts/harness/package-review-prompt.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs package-review-prompt`
