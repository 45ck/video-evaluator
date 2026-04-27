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

## Inputs

Use the same bundle locators as `video-artifact-intake`, plus optional prompt
hints:

```json
{
  "outputDir": "./output/example-run",
  "includePromptHints": true
}
```

`includePromptHints` defaults to `true`. Set it to `false` when you only need a
machine-readable bundle/status summary.

## Outputs

The result includes the normalized intake result plus a review-oriented summary
of artifact availability, report status, recommended focus, and optional prompt
hints. It does not open or deeply evaluate every report.

## Sequencing Guidance

Run `video-artifact-intake` first only if path resolution is ambiguous;
otherwise `review-bundle` can do intake itself. If the review identifies
storyboard files, inspect them directly or continue with
`storyboard-transitions`/`storyboard-understand`. If storyboard files are absent
and a primary video exists, generate them with `storyboard-extract` and
`storyboard-ocr`.

## Interpretation Notes

Treat `fail` or `warn` as routing signals to inspect the named artifact, not as
complete diagnostics. Treat `unknown` as insufficient structured evidence. A
present `trace.zip` means failure evidence may exist outside JSON and should be
unpacked or inspected if relevant to the task.

## Abstention Rules

Do not claim the video is correct because `overallStatus` is `pass`; the skill
only summarizes known reports. Abstain from visual, caption, or UX judgments
unless the result points to concrete artifacts you inspect.

## Failure Modes

If the run directory is wrong, the review will faithfully summarize the wrong
bundle. If reports use custom schemas without `status`, `passed`, or
`hasFailures`, they may appear only as `present`; read them manually before
concluding they passed.

Repo-side runner:

`node --import tsx scripts/harness/review-bundle.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs review-bundle`
