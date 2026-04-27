# Support

`video-evaluator` is an experimental standalone skill pack for grounded video
review artifacts. Support is best handled through reproducible issues with
artifact evidence.

## Where To Ask

- Bugs and feature requests: GitHub issues for this repository.
- Security issues: follow `SECURITY.md`.
- Contribution questions: see `CONTRIBUTING.md`.

## What To Include

For actionable support, include:

- package version or git commit
- operating system and Node.js version
- command or JSON-stdio request that failed
- whether `ffmpeg` and `ffprobe` are on `PATH`
- relevant artifact paths or sanitized snippets
- whether the problem is operational failure or weak semantic output

For YouTube benchmark issues, also include:

- benchmark command and flags
- manifest entry id
- whether the video was pinned by `videoId` or resolved from a query
- `case-report.json` notes, especially OCR quality and low-signal fields

## Scope Of Support

In scope:

- install and runtime failures
- JSON request or response shape confusion
- storyboard extraction, OCR, transition, or summary bugs
- installed skill-pack behavior
- benchmark reporting defects
- documentation gaps

Out of scope:

- requests to clone a creator, channel, product, or proprietary workflow
- claims that require deep arbitrary-video understanding
- product-specific QA logic that belongs in the calling repo
- support for videos that cannot be legally or practically processed by the
  operator

## Interpreting Weak Results

Weak semantic output is not always a bug. If OCR quality is low, narration
dominates the frames, or the video is not UI-heavy, the correct result may be
abstention or sparse summary data.

When reporting weak results, include the generated `storyboard.ocr.json`,
`storyboard.transitions.json`, and `storyboard.summary.json` if they can be
shared. Those files show whether the issue is extraction, OCR, transition
classification, or summary interpretation.
