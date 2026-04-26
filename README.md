# video-evaluator

Shared video evaluation and understanding skill pack for coding-agent
workflows.

This repo is the common review layer for projects like
`content-machine` and `demo-machine`. It does not replace their
domain-specific pipelines. It owns the generic pieces:

- artifact-bundle intake
- latest-run discovery
- storyboard and keyframe extraction
- OCR over extracted storyboard frames
- heuristic storyboard understanding from OCR evidence
- report/status normalization
- review prompt packaging
- bundle-to-bundle comparison
- installable Codex/Claude Code skills

The current shape is intentionally narrow. It helps agents understand
what a video run produced and how to review it, without pretending one
generic scorer can replace domain-specific checks.

## Shipped Tools

- `skill-catalog`
- `install-skill-pack`
- `video-intake`
- `review-bundle`
- `storyboard-extract`
- `storyboard-ocr`
- `storyboard-understand`
- `compare-bundles`
- `package-review-prompt`

## Local Use

```bash
npm install
npm run build
```

Review a bundle:

```bash
cat <<'JSON' | node --import tsx scripts/harness/review-bundle.ts
{
  "outputDir": "../demo-machine/output/todo-app/20260426-000000-000"
}
JSON
```

Extract storyboard frames from a raw video:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-extract.ts
{
  "videoPath": "/path/to/video.mp4",
  "frameCount": 6
}
JSON
```

OCR extracted storyboard frames:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-ocr.ts
{
  "storyboardDir": "./output/storyboard"
}
JSON
```

Generate an evidence-backed storyboard summary:

```bash
cat <<'JSON' | node --import tsx scripts/harness/storyboard-understand.ts
{
  "storyboardDir": "./output/storyboard"
}
JSON
```

Install the skill pack into another repo:

```bash
cat <<'JSON' | node --import tsx scripts/harness/install-skill-pack.ts
{
  "targetDir": ".video-evaluator"
}
JSON
```

That materialized pack now includes the built runtime surface under
`dist/`, and `install-skill-pack` installs runtime dependencies in the
materialized folder by default, so the copied `agent/run-tool.mjs` can
run inside a blank workspace instead of assuming a preinstalled package
dependency.

## Agent Surface

Installed-package consumers should prefer:

```bash
cat <<'JSON' | node ./node_modules/@45ck/video-evaluator/agent/run-tool.mjs review-bundle
{
  "outputDir": "./output"
}
JSON
```

## Direction

Short term:

- stabilize a common artifact contract
- keep video review prompts and summaries consistent across repos
- give Codex and Claude Code a shared skill surface

Later:

- frame-diff helpers
- richer timeline/event understanding
- repo-specific adapters that plug into the shared bundle contract
