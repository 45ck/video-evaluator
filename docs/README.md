# Documentation

This directory explains how to operate and maintain `video-evaluator` as a
standalone video-evaluation skill pack.

The short version:

- The system extracts storyboard and shot evidence from videos.
- OCR and transition inference turn frames into reviewable artifacts.
- Agents should review those artifacts, not guess from the video filename.
- YouTube evaluation is a regression and boundary test, not a cloning workflow.
- Releases are maintenance events for a reusable skill pack, not just npm tags.

## Documents

- [Architecture](./architecture.md): how requests move through the runtime,
  harnesses, skills, and artifact pipeline.
- [Artifact contracts](./artifact-contracts.md): stable fields, compatibility
  expectations, and non-contract diagnostics for storyboard artifacts.
- [Roadmap](./roadmap.md): what remains weak, what should improve next, and
  what should stay out of scope.
- [YouTube evaluation](./youtube-evaluation.md): how to use the public-video
  benchmark as testing without turning it into creator or product cloning.
- [Release process](./release-process.md): release and maintenance expectations
  for a standalone skill pack.
- [Support](../SUPPORT.md): where to ask for help and what information makes an
  issue actionable.

## Operator Model

`video-evaluator` is best treated as an evidence generator. It produces a small
set of artifacts that help a coding agent inspect what happened in a rendered
video, product demo, walkthrough, or output bundle.

The pack is not a full multimodal model runtime. It should not be presented as
deep arbitrary-video understanding. When the OCR or transition evidence is weak,
the correct behavior is to say that the evidence is weak and avoid semantic
claims.

## Common Artifact Flow

The usual local path is:

1. Normalize a video or output folder with `video-intake` or `review-bundle`.
2. Extract frames with `storyboard-extract`.
3. Optionally extract shot segments with `video-shots`.
4. OCR frames with `storyboard-ocr`.
5. Infer frame-to-frame changes with `storyboard-transitions`.
6. Summarize evidence with `storyboard-understand`.
7. Package or compare review evidence with `package-review-prompt` or
   `compare-bundles`.

Typical outputs are:

- `storyboard.manifest.json`
- `storyboard.ocr.json`
- `storyboard.transitions.json`
- `storyboard.summary.json`
- `timeline.evidence.json`
- `video.shots.json`

Those files are the contract operators should inspect when debugging a review.

## When To Use It

Good fits:

- UI-heavy product demos
- app walkthrough recordings
- generated video-output bundles from another repo
- before/after comparisons of rendered runs
- regression tests for extraction, OCR, transitions, and summary behavior

Poor fits today:

- sports, vlogs, cooking, lectures, and other arbitrary public videos
- exact click-by-click action reconstruction
- creator-style replication or product cloning
- compliance claims that require complete semantic understanding

## Baseline Validation

For normal maintenance, run:

```bash
npm run typecheck
npm test
npm run build
```

For benchmark checks, run a limited YouTube pass and inspect both operational
success and semantic quality:

```bash
npm run benchmark:youtube -- --limit=3
```

Treat benchmark output as a signal about system limits. Do not summarize it as
"the system understands YouTube videos" unless the per-case evidence supports
that claim.
