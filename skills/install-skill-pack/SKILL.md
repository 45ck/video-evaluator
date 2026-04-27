---
name: install-skill-pack
description: Materialize the local video-evaluator skill pack into another repo so Codex or Claude Code can use the shared review skills there.
---

# Install Skill Pack

Use this when another repo should consume the local skill pack instead
of re-implementing review helpers.

Outputs:

- copied `skills/*`
- copied runtime under `dist/*`
- optional `agent/run-tool.mjs`
- installed runtime dependencies by default

## Inputs

Required:

```json
{
  "targetDir": ".video-evaluator",
  "includeAgentRunner": true,
  "installDependencies": true
}
```

`targetDir` is relative to the current working directory unless absolute.
`includeAgentRunner` defaults to `true`. `installDependencies` defaults to
`true`.

## Outputs

The result lists copied files, including skill docs/examples, runtime files, and
the optional agent runner. When dependency installation is enabled, the target
pack should be runnable through `node ./.video-evaluator/agent/run-tool.mjs`.

## Sequencing Guidance

Run this from the source `video-evaluator` repo when another repo needs the
pack. After installing, switch to the target repo and run `skill-catalog` via
the installed-pack runner to verify discovery. Then run the narrower skill
needed for the target repo's artifacts.

## Interpretation Notes

This is an installation/materialization helper, not a review skill. It copies
the current local skill docs and built runtime, so source changes that have not
been built may not be reflected in copied runtime behavior.

## Abstention Rules

Do not run this inside a target repo unless you intend to modify or create the
pack directory there. Do not install over another agent's in-progress changes
without checking `git status` in the target repo.

## Failure Modes

Missing built `dist` files, permission errors, or package manager failures can
leave a partial install. If dependency installation is disabled, the target repo
must already have compatible runtime dependencies. Re-run with an explicit
`targetDir` if the pack lands in the wrong location.

Repo-side runner:

`node --import tsx scripts/harness/install-skill-pack.ts`

Installed-pack runner:

`node ./.video-evaluator/agent/run-tool.mjs install-skill-pack`
