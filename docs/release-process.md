# Release Process

`video-evaluator` releases are maintenance checkpoints for a standalone skill
pack. A release should tell downstream operators what changed, whether artifact
contracts changed, and how to validate an installed pack.

## Release Types

Use semantic versioning in the practical sense:

- Patch: docs, packaging, diagnostics, or bug fixes that preserve request and
  artifact compatibility.
- Minor: new tools, new artifact fields, improved inference behavior, or
  compatible skill-pack additions.
- Major: breaking request shapes, removed fields, renamed artifacts, or changed
  artifact semantics that downstream callers must adapt to.

For experimental releases, still document compatibility clearly. Other repos may
depend on the skill-pack surface even before the project is mature.

## Pre-Release Checklist

Run the baseline checks:

```bash
npm run typecheck
npm test
npm run build
```

Then verify operator surfaces:

- Skill catalog lists the expected skills.
- `install-skill-pack` can materialize a pack into a temporary directory.
- The installed `agent/run-tool.mjs` can run at least one simple JSON-stdio
  request.
- [Artifact contracts](./artifact-contracts.md) are updated when names, stable
  fields, or compatibility expectations change.
- YouTube benchmark claims distinguish operational and semantic success.
- `CHANGELOG.md` has a concise entry for user-visible changes.

## Suggested Local Smoke Checks

Catalog:

```bash
cat <<'JSON' | node --import tsx scripts/harness/skill-catalog.ts
{}
JSON
```

Install into a temporary directory:

```bash
cat <<'JSON' | node --import tsx scripts/harness/install-skill-pack.ts
{
  "targetDir": "/tmp/video-evaluator-pack"
}
JSON
```

Run a tool through the installed pack:

```bash
cat <<'JSON' | node /tmp/video-evaluator-pack/agent/run-tool.mjs skill-catalog
{}
JSON
```

For video-specific changes, also run a small local video through extraction,
OCR, transitions, and understanding, then inspect the generated artifacts.

## Changelog Expectations

Every release entry should mention:

- new or changed tools
- artifact contract changes
- benchmark or fixture changes
- known regressions or weak spots
- migration notes for installed-pack users

Avoid vague claims such as "better understanding" unless the change is tied to a
specific artifact, metric, or fixture.

## Standalone Skill-Pack Maintenance

The skill pack is intended to be copied into other workspaces. That means
release quality includes more than TypeScript correctness.

Maintain:

- stable skill names
- stable JSON-stdio behavior
- clear error messages for missing inputs and missing external tools
- installable runtime files
- bundled OCR assets needed for offline operation
- docs that explain confidence, low-signal results, and abstention

When a field or tool must change, prefer an additive transition first. Give
downstream users time to update before removing old behavior.

## Publishing Notes

Before tagging:

1. Ensure the working tree only contains intentional release changes.
2. Run the release checks.
3. Update `CHANGELOG.md`.
4. Confirm package metadata and included files match the intended release
   surface.
5. Create a lightweight semver tag such as `v0.1.1`.

After tagging, verify the released artifact or installed pack from a clean
location. A release is not complete until a downstream operator can install and
invoke the pack without relying on local repo state.
