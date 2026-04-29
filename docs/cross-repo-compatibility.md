# Cross-Repo Compatibility

`video-evaluator` is the canonical shared analyzer for generated or captured
video runs. Consumer repos can wrap its runners, but stable analyzer artifacts
should keep the names and schema versions documented here.

Current consumers:

- `45ck/demo-machine` depends on `@45ck/video-evaluator` for completed-run
  analysis, review prompts, visual evidence, layout safety, and generic visual
  diff primitives. It still owns browser capture, playback semantics,
  selector/action validation, and its top-level demo `quality.json` policy.
- `45ck/content-machine` uses the evaluator as the shared analyzer owner for
  promoted short-form examples and docs/demo audits. It still owns skills,
  archetype recipes, short-form generation, render decisions, and publish
  readiness policy.

## Canonical Bundle Files

When a repo wants a portable review bundle, prefer these files at the bundle
root:

- `analyzer.report.json`: top-level `analyzer-report.v1` orchestration result.
- `media-probe.json`: `media-probe.v1` ffprobe-derived media facts.
- `quality-gates.json`: `quality-gates.v1` collapsed pass/warn/fail gates.
- `caption-artifact.json`: `caption-artifact.v1` caption or transcript cues.
- `demo-capture-evidence.json`: `demo-capture-evidence.v1` screenshots and
  action-event evidence produced by demo-style capture systems.
- `review-bundle.json`: optional bundle inventory for handoff.
- `video-technical.report.json`: optional technical review if run at the root.
- `technical-review/video-technical.report.json`: technical review when nested
  under analyzer output.

Older or product-specific artifacts can still exist beside these files. For
example, `demo-machine` also writes `quality.json`,
`output/visual-diff-report.json`, screenshot manifests, verification manifests,
and Playwright traces. The canonical analyzer files are the compatibility layer
that `content-machine`, `demo-machine`, and future repos should consume first;
package review prompts may summarize repo-specific artifacts only as supporting
evidence.

## Consumer Rules

- Check `schemaVersion` before reading stable fields.
- Ignore unknown fields and tolerate missing optional fields.
- Treat `status: "warn"` as actionable evidence, not as a hard failure.
- Use artifact references inside `analyzer.report.json` to locate nested output,
  but keep root-level canonical files when a bundle is meant for cross-repo
  handoff.
- Keep product-specific policy out of analyzer artifacts. Put repo-specific
  verdicts, publishing metadata, generation settings, or demo semantics in
  separate files.
- Do not move producer runtime behavior into `video-evaluator`. The evaluator
  should analyze artifacts from producers, not become the capture or rendering
  control plane.

## Compatibility Fixture

The fixture at `tests/fixtures/canonical-analyzer-bundle/` is the minimal
cross-repo contract sample. It validates:

- public contract schemas accept the canonical files;
- bundle intake discovers canonical analyzer artifacts;
- `package-review-prompt` mentions those reports so reviewer agents inspect the
  shared analyzer output before product-specific evidence.

Update the fixture and `tests/compat-canonical-analyzer.test.ts` when adding a
new root-level canonical artifact name or changing compatibility expectations.
