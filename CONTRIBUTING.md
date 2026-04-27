# Contributing

## Scope

This repo is for grounded video evaluation and understanding artifacts.

Good contributions usually improve one of these areas:

- storyboard extraction and sampling quality
- OCR quality and filtered UI evidence
- transition inference
- summary accuracy and abstention behavior
- benchmark quality and benchmark honesty
- artifact contract stability
- installable skill-pack ergonomics

Avoid broad claims or new features that make the repo sound more capable
than it actually is.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Change Standard

Before opening a PR or merging a local change:

- keep README and [artifact contracts](./docs/artifact-contracts.md)
  aligned with the current capability
- add or update tests when artifact shape or inference behavior changes
- prefer explicit abstention over weak semantic claims
- keep benchmark reporting honest; operational success is not the same as
  semantic understanding
- update skill docs when a tool's required input, output, sequencing, or
  failure behavior changes

## Benchmarking

The public benchmark runner is useful for regression checks, but not all
cases are equal.

- treat `gold` and `provisional` cases differently
- pay attention to `ocrQuality.lowSignal`
- do not present benchmark success as proof of deep video understanding

## Releases

Use lightweight semver tags for meaningful repo milestones.

Examples:

- `v0.1.0` initial standalone pack
- `v0.1.1` docs or packaging fix
- `v0.2.0` new artifact contract or major semantic improvement
