# Artifact Contracts

This document describes the compatibility contract for artifacts emitted by the
current video-evaluator tools. It is a consumer-facing contract, not a complete
debug dump specification.

## Compatibility Model

Artifacts are JSON files with a top-level `schemaVersion`. Consumers must check
the artifact file name and `schemaVersion` before relying on fields. Older
storyboard artifacts use integer schema versions; named cross-tool artifacts may
use string-literal schema versions.

Compatibility expectations:

- Producers may add new optional fields without changing `schemaVersion`.
- Producers must not remove, rename, or change the type or meaning of stable fields
  within the same `schemaVersion`.
- Consumers must ignore unknown fields.
- Consumers must tolerate missing optional fields.
- Numeric timestamps and durations are seconds.
- Paths are serialized as strings and are normally absolute paths from the machine
  that generated the artifact. Consumers should not assume they are portable across
  machines.
- Arrays preserve producer order unless the field description says otherwise.
- Fields listed as non-contract are current implementation details. They may change
  without a schema-version bump and should be used only for diagnostics, previews, or
  best-effort heuristics.

## Shared Storyboard Concepts

Several artifacts repeat frame sampling fields. Their stable values are:

- `samplingMode`: `"uniform"`, `"hybrid"`, or `"segment"`.
- `samplingReason`: `"uniform"`, `"change-peak"`, or `"coverage-fill"`.
- `samplingSignal`: `"scene-change"` or `"same-screen-change"`.
- OCR/text `region`: `"top"`, `"middle"`, or `"bottom"`.

Consumers should treat scores, confidence values, OCR text, inferred labels, and
diagnostic notes as model- or heuristic-derived evidence, not as ground truth.

## `analyzer.report.json`

Schema version: string literal `analyzer-report.v1`.

Produced by `analyze-video` and `analyze-bundle`. This is the canonical
orchestration report that points to lower-level evidence instead of replacing
specialized artifacts.

Stable top-level fields:

- `schemaVersion`: `"analyzer-report.v1"`.
- `createdAt` and `completedAt`: ISO-8601 timestamp strings for the analysis run.
- `request`: normalized analyzer request when available.
- `subject`: analyzed video, bundle, demo capture, or comparison subject.
- `status`: collapsed `"pass"`, `"warn"`, `"fail"`, `"skip"`, or `"unknown"` status.
- `metrics`: summary metrics promoted from child artifacts.
- `mediaProbe`: contract-shaped `media-probe.v1` facts when probing ran.
- `qualityGates`: contract-shaped `quality-gates.v1` report when gates ran.
- `captionArtifacts`: generated `caption-artifact.v1` records when captions ran.
- `artifacts`: paths to generated and consumed evidence artifacts.
- `diagnostics`: orchestration, probe, quality, caption, and technical-review issues.

Current child artifacts emitted by the orchestrator include `media-probe.json`,
`quality-gates.json`, `caption-artifact.json`,
`technical-review/video-technical.report.json`, and `review-bundle.json` when
the corresponding inputs or capabilities are present.

For cross-repo compatibility bundles, keep `analyzer.report.json` at the bundle
root and prefer root-level copies of `media-probe.json`, `quality-gates.json`,
and `caption-artifact.json` when those capabilities ran. Consumer repos should
use these canonical files before reading product-specific reports.

## `layout-annotations.v1.json`

Schema version: string literal `layout-annotations.v1`.

Consumed by `layout-safety-review`. This is an optional producer-authored sidecar
for generated videos where the renderer knows the intended graphic boxes. It lets
review tools catch card, caption, diagram, and UI collisions without trying to
infer every visual layer from pixels.

Stable top-level fields:

- `schemaVersion`: `"layout-annotations.v1"`.
- `videoWidth`: source render width in pixels.
- `videoHeight`: source render height in pixels.
- `safeZones`: named boxes, usually including `caption`.
- `frames`: sampled layout frames with `timeSeconds` and `elements`.

Stable element fields:

- `id`: stable element identifier.
- `role`: element role such as `primary`, `support`, `visual`, `progress`,
  `navigation`, `caption`, `container`, `background`, or `decorative`.
- `box`: `{ x0, y0, x1, y1 }` in pixels or normalized coordinates.
- `allowOverlapWith`: optional list of element ids that may overlap.
- `ignoreOverlap`: optional boolean for containers or purely diagnostic elements.

## `layout-safety.report.json`

Schema version: string literal `layout-safety-report.v1`.

Produced by `layout-safety-review`.

Stable top-level fields:

- `schemaVersion`: `"layout-safety-report.v1"`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `videoPath`: reviewed video path.
- `outputDir`: report output directory.
- `layoutPath`: layout sidecar path when supplied.
- `storyboardManifestPath`: sampled storyboard manifest path.
- `ocrPath`: OCR artifact path when OCR review ran.
- `sampledFrameCount`: number of visual frames sampled.
- `checkedLayoutFrameCount`: number of declared layout frames checked.
- `issues`: ordered review issues.
- `metrics.maxDeclaredOverlapRatio`: largest disallowed declared overlap.
- `metrics.maxCaptionZoneOverlapRatio`: largest non-caption collision with the
  caption safe zone.
- `metrics.ocrTextOverlapCount`: count of OCR text-box overlap warnings.

## `video-technical.report.json`

Schema version: string literal `video-technical-report.v1`.

Produced by `video-technical-review`.

Stable top-level fields:

- `schemaVersion`: `"video-technical-report.v1"`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `videoPath`: reviewed video path.
- `outputDir`: report output directory.
- `contactSheetPath`: path to `contact-sheet.png` when frame sampling
  succeeded.
- `contactSheetMetadataPath`: path to `contact-sheet.metadata.json` when frame
  sampling succeeded.
- `layoutReportPath`: source layout report path when supplied.
- `probe`: detected duration, resolution, frame rate, and stream counts.
- `audio`: measured audio volume fields when available.
- `sampledFrameCount`: number of technical-review frames sampled.
- `issues`: ordered technical issues.
- `metrics`: aggregate sampled-frame metrics.
- `thresholds`: thresholds used to produce the report.

Stable issue codes:

- `wrong-resolution`
- `missing-audio`
- `near-silent-audio`
- `white-flash-or-white-frame`
- `black-frame`
- `white-edge-artifact`
- `black-gutter-artifact`
- `low-motion-run`
- `caption-band-sparse`
- `layout-*` pass-through issues from `layoutReportPath`

## `visual-diff.v1`

Schema version: string literal `visual-diff.v1`.

Produced by `golden-frame-compare` and `demo-visual-review`.

Stable top-level fields:

- `schemaVersion`: `"visual-diff.v1"`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `left`: baseline frame or baseline-frame collection reference.
- `right`: current frame or current-frame collection reference.
- `threshold`: maximum mismatch ratio allowed for pass status.
- `overallStatus`: `"pass"`, `"warn"`, `"fail"`, or `"skip"`.
- `frames`: compared frame records.
- `summary.comparedFrameCount`: number of frame pairs actually compared.
- `summary.averageMismatchPercent`: average normalized mismatch ratio for compared frames.
- `summary.maxMismatchPercent`: largest normalized mismatch ratio for compared frames.
- `summary.metrics.maxMismatchPercent`: thresholded gate metric.
- `diagnostics`: missing baseline/current frame, baseline update, or dimension mismatch diagnostics.

Stable frame fields:

- `index`: zero-based frame index in comparison order.
- `timestampSeconds`: optional source timestamp.
- `leftFramePath`: baseline frame path.
- `rightFramePath`: current frame path.
- `mismatchPixelCount`: pixel count reported by image diff.
- `totalPixelCount`: compared pixel count.
- `mismatchPercent`: normalized mismatch ratio from `0` to `1`.
- `metadata.status`: per-frame threshold status.

Known diagnostic codes:

- `missing-baseline-frame`
- `missing-current-frame`
- `dimension-mismatch`
- `baseline-updated`

## `contact-sheet.metadata.json`

Schema version: string literal `contact-sheet-metadata.v1`.

Produced by `video-technical-review`.

Stable top-level fields:

- `schemaVersion`: `"contact-sheet-metadata.v1"`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `videoPath`: reviewed video path.
- `outputDir`: report output directory.
- `contactSheetPath`: path to the sampled-frame contact sheet image.
- `sampledFrameCount`: number of sampled frames.
- `frames`: ordered sampled-frame metadata with timestamp, optional image path,
  and technical metrics.

## `storyboard.manifest.json`

Schema version: `1`.

Produced by storyboard extraction. This is the canonical manifest for sampled frame
images and sampling metadata.

Stable top-level fields:

- `schemaVersion`: `1`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `videoPath`: source video path string.
- `outputDir`: directory containing the storyboard artifact and frame images.
- `frameCount`: requested number of sampled frames.
- `durationSeconds`: detected source video duration in seconds.
- `format`: frame image format, `"jpg"` or `"png"`.
- `samplingMode`: `"uniform"`, `"hybrid"`, or `"segment"`. Segment mode is
  produced by `segment-storyboard`, not by the standard `storyboard-extract`
  request.
- `changeThreshold`: present for hybrid sampling; scene-change threshold used during
  candidate detection.
- `detectedChangeCount`: present for hybrid sampling; count of primary detected change
  candidates before frame selection.
- `frames`: ordered storyboard frame records.

Stable frame fields:

- `index`: one-based frame index.
- `timestampSeconds`: timestamp sampled from the source video.
- `imagePath`: path to the extracted frame image.
- `samplingReason`: reason this frame was selected.
- `nearestChangeDistanceSeconds`: present for hybrid sampling when available; distance
  to the nearest primary detected change candidate.
- `samplingSignal`: present for change-peak frames when available; candidate source.
- `samplingScore`: present for change-peak frames when available; candidate score.
- `sourceShotIndex`: present for segment storyboards; source
  `video.shots.json` shot index.
- `segmentPosition`: present for segment storyboards; `"early"`, `"middle"`,
  or `"late"`.

Known non-contract fields:

- `frames[*].sourceShotIndex` and `frames[*].segmentPosition` are meaningful
  only for `samplingMode: "segment"`.
- `candidateDiagnostics`: debug summary of hybrid candidate selection.
- `candidateDiagnostics.sourceCounts`.
- `candidateDiagnostics.contextGeneratedCount`.
- `candidateDiagnostics.topCandidates`.
- `candidateDiagnostics.topCandidates[*].diagnostics`.
- `candidateDiagnostics.topCandidates[*].contextGenerated`.

## `storyboard.ocr.json`

Schema version: `2`.

Produced by OCR over storyboard frames. This artifact carries raw OCR lines, filtered
semantic UI lines, and per-frame OCR quality.

Stable top-level fields:

- `schemaVersion`: `2`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `storyboardManifestPath`: path to the source `storyboard.manifest.json`.
- `storyboardDir`: storyboard directory.
- `videoPath`: source video path string.
- `minConfidence`: OCR confidence threshold used when extracting lines.
- `samplingMode`: copied from the storyboard manifest when available.
- `changeThreshold`: copied from the storyboard manifest when available.
- `detectedChangeCount`: copied from the storyboard manifest when available.
- `frames`: ordered OCR frame records.
- `summary`: aggregate OCR summary.

Stable frame fields:

- `index`: one-based frame index from the storyboard manifest.
- `timestampSeconds`: frame timestamp in seconds.
- `imagePath`: source frame image path.
- `samplingReason`, `nearestChangeDistanceSeconds`, `samplingSignal`, `samplingScore`:
  copied from the storyboard frame when available.
- `imageWidth`: OCR-observed image width when available.
- `imageHeight`: OCR-observed image height when available.
- `lines`: OCR line records that met `minConfidence`.
- `semanticLines`: OCR line records classified as UI evidence.
- `quality`: per-frame OCR quality summary.
- `text`: newline-joined text from `lines`.

Stable OCR line fields:

- `text`: normalized OCR text.
- `confidence`: OCR confidence number.
- `bbox`: bounding box when available.
- `bbox.x0`, `bbox.y0`, `bbox.x1`, `bbox.y1`: pixel coordinates.
- `bbox.width`, `bbox.height`: pixel dimensions.
- `bbox.centerX`, `bbox.centerY`: pixel center coordinates.
- `region`: `"top"`, `"middle"`, or `"bottom"` when available.
- `evidenceRole`: `"ui"`, `"subtitle-like"`, or `"garbage"` when classified.
- `suppressionReasons`: reason strings for non-UI or low-trust lines when available.

Stable quality fields:

- `status`: `"usable"`, `"weak"`, or `"reject"`.
- `usableLineCount`: number of semantic UI lines.
- `usableLineShare`: semantic UI lines divided by all classified lines.
- `averageConfidence`: average confidence across classified lines.
- `topAnchorCount`: semantic UI lines in the top region.
- `bottomSentenceShare`: share of subtitle-like bottom-region lines.
- `reasons`: quality reason strings.

Stable summary fields:

- `uniqueLines`: unique raw OCR line texts in first-seen order.
- `uniqueSemanticLines`: unique semantic UI line texts in first-seen order.
- `concatenatedText`: newline-joined `uniqueLines`.
- `concatenatedSemanticText`: newline-joined `uniqueSemanticLines`.
- `quality.usableFrames`: count of frames with quality status `"usable"`.
- `quality.weakFrames`: count of frames with quality status `"weak"`.
- `quality.rejectedFrames`: count of frames with quality status `"reject"`.

Known non-contract fields:

- The specific strings in `suppressionReasons`, `quality.reasons`, and OCR text fields.
- Exact `confidence`, `usableLineShare`, `averageConfidence`, and region-assignment
  values, which can vary with OCR engine behavior and preprocessing changes.

## `storyboard.transitions.json`

Schema version: `1`.

Produced by transition inference between adjacent OCR frames. This artifact describes
frame-to-frame changes using visual diff and OCR evidence.

Stable top-level fields:

- `schemaVersion`: `1`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `ocrPath`: path to the source `storyboard.ocr.json`.
- `storyboardDir`: storyboard directory.
- `videoPath`: source video path string.
- `threshold`: visual-diff threshold used during transition inference.
- `transitions`: ordered transition records between adjacent frames.

Stable transition fields:

- `fromFrameIndex`: source frame index.
- `toFrameIndex`: destination frame index.
- `fromTimestampSeconds`: source frame timestamp in seconds.
- `toTimestampSeconds`: destination frame timestamp in seconds.
- `visualDiffPercent`: image mismatch ratio from visual diff.
- `overlapRatio`: normalized text-overlap ratio.
- `sharedLineCount`: number of shared normalized OCR lines.
- `transitionKind`: `"screen-change"`, `"state-change"`, `"scroll-change"`,
  `"dialog-change"`, or `"uncertain"`.
- `addedLines`: OCR evidence lines that appeared in the destination frame.
- `removedLines`: OCR evidence lines that disappeared from the source frame.
- `inferredTransition`: human-readable transition label.
- `confidence`: heuristic confidence score.
- `evidence`: human-readable evidence strings.

Known non-contract fields:

- The exact contents and ordering of `addedLines`, `removedLines`, `inferredTransition`,
  and `evidence`.
- Exact `visualDiffPercent`, `overlapRatio`, `sharedLineCount`, and `confidence` values.
- Classification thresholds and heuristics behind `transitionKind`.

## `storyboard.summary.json`

Schema version: `2`.

Produced by storyboard understanding over OCR and, when present, transition artifacts.
This artifact is an interpretive summary for review workflows.

Stable top-level fields:

- `schemaVersion`: `2`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `ocrPath`: path to the source `storyboard.ocr.json`.
- `storyboardDir`: storyboard directory.
- `videoPath`: source video path string.
- `appNames`: inferred application or product names.
- `views`: inferred view or screen labels.
- `ocrQuality`: aggregate OCR quality summary.
- `sampling`: aggregate sampling summary.
- `interactionSegments`: inferred same-screen or workflow segments.
- `likelyFlow`: text labels for confident frame-to-frame flow steps.
- `likelyCapabilities`: inferred capability claims with frame evidence.
- `openQuestions`: review questions for unresolved ambiguity.
- `textDominance`: summary of likely narration/subtitle dominance.

Stable `ocrQuality` fields:

- `usableFrameShare`: share of OCR frames with `"usable"` quality.
- `weakFrameShare`: share of OCR frames with `"weak"` quality.
- `rejectedFrameShare`: share of OCR frames with `"reject"` quality.
- `lowSignal`: whether OCR evidence is low-signal.
- `notes`: human-readable quality notes.

Stable `sampling` fields:

- `mode`: `"uniform"` or `"hybrid"` when available.
- `detectedChangeCount`: detected primary change count when available.
- `frameReasonCounts.uniform`: count of uniform-selected frames.
- `frameReasonCounts.change-peak`: count of change-peak-selected frames.
- `frameReasonCounts.coverage-fill`: count of coverage-fill-selected frames.
- `averageNearestChangeDistanceSeconds`: average nearest-change distance when available.
- `notes`: human-readable sampling notes.

Stable interaction segment fields:

- `startFrameIndex`: first frame index in the segment.
- `endFrameIndex`: last frame index in the segment.
- `startTimestampSeconds`: first segment timestamp.
- `endTimestampSeconds`: last segment timestamp.
- `transitionKinds`: transition kinds included in the segment.
- `summary`: human-readable segment summary.
- `evidence`: human-readable evidence strings.

Stable capability claim fields:

- `claim`: inferred capability statement.
- `evidence`: supporting OCR evidence records.
- `evidence[*].frameIndex`: frame index containing the evidence line.
- `evidence[*].line`: supporting OCR line.

Stable `textDominance` fields:

- `likelyNarrationDominated`: whether extracted text appears dominated by narration or
  subtitles rather than UI.
- `narrationLikeLineShare`: share of OCR lines classified as narration-like.
- `narrationLikeFrameShare`: share of frames with narration-like dominance.
- `dominantRegion`: `"top"`, `"middle"`, `"bottom"`, or `"mixed"` when available.
- `notes`: human-readable text-dominance notes.

Known non-contract fields:

- Exact strings and ordering in `appNames`, `views`, `likelyFlow`, `openQuestions`,
  `ocrQuality.notes`, `sampling.notes`, `interactionSegments[*].summary`,
  `interactionSegments[*].evidence`, `likelyCapabilities[*].claim`,
  `likelyCapabilities[*].evidence[*].line`, and `textDominance.notes`.
- Exact share and average values, which may shift with OCR, sampling, and inference
  heuristic changes.

## `timeline.evidence.json`

Schema version: `1`.

Produced during bundle intake when one or more timeline source artifacts are
available. This artifact normalizes producer-specific time evidence into a
single ordered list that review prompts and downstream adapters can inspect.

Current source artifacts:

- `timestamps.json`: content-machine-style scene and word timestamps.
- `events.json`: demo-machine-style action events.
- `subtitles.vtt`: WebVTT caption cues.

Stable top-level fields:

- `schemaVersion`: `1`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `rootDir`: source bundle root directory.
- `sourceArtifacts`: map of source artifact names to paths.
- `evidence`: ordered timeline evidence records.
- `summary`: aggregate counts and inferred duration.

Stable evidence fields:

- `id`: stable per-artifact evidence id assigned in timeline order.
- `kind`: `"transcript"`, `"caption"`, or `"action"`.
- `sourceType`: `"timestamps-scene"`, `"timestamps-words"`,
  `"subtitles-vtt"`, or `"events-json"`.
- `sourcePath`: path to the source artifact.
- `startSeconds`: evidence start time in seconds.
- `endSeconds`: evidence end time in seconds.
- `text`: normalized text for transcript or caption evidence when available.
- `action`: action label for action evidence when available.
- `confidence`: average source confidence when available.
- `metadata`: source-specific diagnostic fields.

Stable summary fields:

- `transcriptItems`: number of transcript evidence records.
- `captionItems`: number of caption evidence records.
- `actionItems`: number of action evidence records.
- `durationSeconds`: max known evidence end time when available.

Known non-contract fields:

- Exact `id` numbering can change when producer artifacts add or remove items.
- Exact `text` spacing can change with source parser normalization.
- Source-specific `metadata` keys are diagnostic and may change without a
  schema-version bump.

## `video.shots.json`

Schema version: `1`.

Produced by `video-shots` from a local video. This artifact provides coarse
scene-change segments and optional representative frame images for each segment.
It is a visual part map, not a semantic edit decision list.

Stable top-level fields:

- `schemaVersion`: `1`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `videoPath`: source video path string.
- `outputDir`: directory containing `video.shots.json` and optional frames.
- `durationSeconds`: detected source video duration in seconds.
- `sceneThreshold`: scene-change threshold used for detection.
- `minShotDurationSeconds`: minimum segment duration used during boundary
  filtering and merging.
- `detectedBoundaryCount`: raw detected scene-boundary count before segment
  filtering.
- `shots`: ordered shot segment records.

Stable shot fields:

- `index`: one-based shot index.
- `startSeconds`: segment start time in seconds.
- `endSeconds`: segment end time in seconds.
- `durationSeconds`: segment duration in seconds.
- `representativeTimestampSeconds`: timestamp used for the representative frame.
- `representativeFramePath`: path to the extracted representative frame when
  frame extraction was enabled.
- `boundaryStart`: `"video-start"` or `"scene-change"`.
- `boundaryEnd`: `"scene-change"` or `"video-end"`.

Known non-contract fields:

- Exact shot boundaries can vary with codec behavior, `ffmpeg` scene detection,
  source compression, and the chosen `sceneThreshold`.
- Representative frames are diagnostics. Consumers should not assume they are
  portable across machines.

## `segment.evidence.json`

Schema version: `1`.

Produced by `segment-evidence` after `video.shots.json` exists. This artifact
maps each shot segment to overlapping storyboard frames, OCR text, transition
records, and timeline evidence. It is an evidence router, not a semantic
understanding verdict.

Stable top-level fields:

- `schemaVersion`: `1`.
- `createdAt`: ISO-8601 timestamp string for artifact creation.
- `rootDir`: source bundle root directory when available.
- `videoPath`: primary video path when available.
- `sourceArtifacts`: map of source artifact names to paths.
- `segments`: ordered segment evidence records.
- `summary`: aggregate segment counts and source artifact names.

Stable segment fields:

- `index`: one-based segment index.
- `sourceShotIndex`: source `video.shots.json` shot index.
- `startSeconds`: segment start time in seconds.
- `endSeconds`: segment end time in seconds.
- `durationSeconds`: segment duration in seconds.
- `representativeTimestampSeconds`: timestamp chosen by `video-shots` when
  available.
- `representativeFramePath`: representative shot frame path when available.
- `evidenceStatus`: `"usable"`, `"weak"`, or `"empty"`.
- `evidenceCounts`: counts of mapped storyboard, OCR, timeline, and transition
  evidence.
- `storyboardFrames`: overlapping storyboard frame records.
- `timelineItems`: overlapping timeline evidence records.
- `transitions`: overlapping storyboard transition records.
- `textEvidence`: selected OCR and timeline text snippets for quick review.
- `notes`: human-readable abstention or routing notes.

Stable `evidenceCounts` fields:

- `storyboardFrames`: count of storyboard frames inside the segment.
- `usableOcrFrames`: count of overlapping OCR frames with usable quality.
- `weakOcrFrames`: count of overlapping OCR frames with weak quality.
- `rejectedOcrFrames`: count of overlapping OCR frames with rejected quality.
- `timelineItems`: count of overlapping timeline items.
- `transitions`: count of overlapping transitions.

Known non-contract fields:

- `evidenceStatus` is a routing heuristic. It can change as OCR, transition,
  and timeline quality heuristics improve.
- `textEvidence` selection and ordering are preview-oriented and may change
  without a schema-version bump.
