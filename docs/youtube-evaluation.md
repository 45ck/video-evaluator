# YouTube Evaluation

The YouTube benchmark exists to test `video-evaluator` against messy public
videos and keep capability claims honest. It is not a workflow for cloning
creators, products, editing styles, or applications.

Use it as a regression and boundary test:

- Can the pipeline resolve, download, clip, and process a public video?
- Does OCR produce usable UI evidence or correctly report low signal?
- Do summaries avoid strong claims when footage is narration-heavy,
  subtitle-heavy, or not UI-oriented?
- Do benchmark reports distinguish operational success from semantic success?

Do not use it as:

- proof that the system deeply understands arbitrary YouTube videos
- a recipe for copying another creator's content
- a way to clone a product UI or proprietary workflow
- a replacement for local deterministic fixtures

## Running A Small Check

```bash
npm run benchmark:youtube -- --limit=3
```

Useful options include:

- `--manifest=benchmarks/youtube-diverse-queries.json`
- `--output-root=/tmp/video-evaluator-youtube-benchmark`
- `--limit=10`
- `--frame-count=8`
- `--clip-seconds=75`
- `--change-threshold=0.08`
- `--min-confidence=45`
- `--min-operational-successes=3`
- `--max-negative-control-false-positives=0`
- `--min-gold-high-fit-semantic-passes=1`

The benchmark resolves public videos, downloads or clips them with `yt-dlp`,
runs storyboard extraction, OCR, transitions, and understanding, then writes
per-case and aggregate reports.

The three gate flags are optional. If any are set, the aggregate report includes
a `gate` block and the process exits non-zero when a configured threshold fails.
Without gate flags, the benchmark remains report-only.

## Reading Results

Inspect both per-case reports and aggregate metrics. The important distinction
is:

- Operational pass: the case downloaded, clipped, processed, and wrote reports.
- Semantic pass: the artifacts contain enough evidence to support the expected
  app, view, flow, or capability signal.

Metrics such as low-signal cases, narration dominance, meaningful flow, and OCR
quality matter more than a raw completion count.

If a case only recovers generic transition labels such as `screen-change` but no
useful UI evidence, treat it as weak semantic recovery even if the pipeline
completed.

## Manifest Policy

Prefer stable, auditable entries:

- Use `videoId` or `url` for pinned cases.
- Keep `query` as provenance or fallback, not as the main source of truth.
- Use `channelContains` and `titleContains` to make intent reviewable.
- Use `startSeconds` and `clipSeconds` to avoid intros and target relevant
  segments.
- Mark cases as `gold`, `provisional`, `negative-control`, or `needs-retune`
  when that distinction matters.

Negative controls are valuable. The benchmark should include videos where the
correct behavior is low confidence, sparse semantics, or explicit abstention.

## Ethical And Practical Boundary

Public videos are useful because they are diverse and noisy. That does not make
them templates to copy.

Evaluation should focus on the evaluator:

- extraction quality
- OCR quality
- transition classification
- summary abstention
- benchmark reporting honesty

Evaluation should not focus on reproducing another party's creative choices,
scripts, visual identity, product behavior, or proprietary information.

When writing benchmark notes, describe evidence categories and failure modes.
Avoid instructions that would help clone a creator, channel, product, or
commercial workflow.

## Recommended Maintenance Pattern

Use YouTube checks sparingly and deliberately:

1. Run small limits during local development.
2. Inspect low-signal and failed cases manually.
3. Promote only stable, useful cases to stronger curation status.
4. Keep deterministic local tests as the primary release gate.
5. Report benchmark results with caveats about public-video availability and
   semantic limits.

If public-video availability changes, update the manifest and explain why. Do
not silently retune the benchmark to make metrics look better.
