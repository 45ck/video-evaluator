import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import {
  ANALYZER_REPORT_SCHEMA_VERSION,
  ANALYZER_REQUEST_SCHEMA_VERSION,
  type AnalyzerCapability,
  type AnalyzerReport,
  type AnalyzerRequest,
} from "../contracts/analyzer.js";
import {
  CAPTION_ARTIFACT_SCHEMA_VERSION,
  type CaptionArtifact,
  type CaptionCue as ContractCaptionCue,
} from "../contracts/captions.js";
import type {
  AnalyzerSubject,
  ArtifactReference,
  ContractDiagnostic,
  ContractStatus,
  MetricValue,
} from "../contracts/common.js";
import {
  MEDIA_PROBE_SCHEMA_VERSION,
  type MediaProbeArtifact as ContractMediaProbeArtifact,
} from "../contracts/media.js";
import {
  QUALITY_GATES_SCHEMA_VERSION,
  type QualityGateReport,
  type QualityGateResult,
} from "../contracts/quality.js";
import {
  parseCaptionSidecar,
  reviewCaptionOcr,
  reviewCaptionQuality,
  reviewCaptionSync,
  type CaptionCue,
  type CaptionIssue,
  type CaptionOcrBox,
  type CaptionSidecarSource,
} from "../captions/index.js";
import { intakeBundle, type BundleArtifactMap } from "../core/bundle.js";
import {
  VideoTechnicalReviewRequestSchema,
  type VideoTechnicalReviewRequest,
} from "../core/schemas.js";
import {
  defaultVideoTechnicalOutputDir,
  reviewVideoTechnical,
  type VideoTechnicalIssue,
} from "../core/video-technical-review.js";
import {
  evaluateRenderQualityGates,
  type QualityGatesArtifact,
  type RenderQualityGatePolicy,
} from "../quality/gates.js";
import {
  probeMedia,
  type MediaProbeArtifact as RawMediaProbeArtifact,
} from "../probe/media.js";
import {
  AnalyzeBundleRequestSchema,
  AnalyzeVideoRequestSchema,
  type AnalyzeBundleRequest,
  type AnalyzeVideoRequest,
} from "./schemas.js";

type Now = () => Date;

export interface AnalyzeVideoDependencies {
  now?: Now;
  probeMedia?: typeof probeMedia;
  evaluateRenderQualityGates?: typeof evaluateRenderQualityGates;
  reviewVideoTechnical?: typeof reviewVideoTechnical;
}

interface MutableReportParts {
  metrics: Record<string, MetricValue>;
  artifacts: ArtifactReference[];
  diagnostics: ContractDiagnostic[];
  mediaProbe?: ContractMediaProbeArtifact;
  qualityGates?: QualityGateReport;
  captionArtifacts: CaptionArtifact[];
  metadata: Record<string, unknown>;
}

interface AnalyzerOptions {
  qualityPolicy?: RenderQualityGatePolicy;
  captionPath?: string;
  captionSidecarPath?: string;
  captionOcrPath?: string;
  ocrBoxes?: CaptionOcrBox[];
  runVideoTechnicalReview?: boolean;
  videoTechnicalReview?: Partial<VideoTechnicalReviewRequest>;
}

const DEFAULT_VIDEO_CAPABILITIES: AnalyzerCapability[] = [
  "media-probe",
  "quality-gates",
];

const DEFAULT_BUNDLE_CAPABILITIES: AnalyzerCapability[] = [
  "media-probe",
  "quality-gates",
  "review-bundle",
];

export async function analyzeVideo(
  request: AnalyzeVideoRequest,
  dependencies: AnalyzeVideoDependencies = {},
): Promise<AnalyzerReport & { reportPath: string }> {
  const input = AnalyzeVideoRequestSchema.parse(request);
  const now = dependencies.now ?? (() => new Date());
  const createdAt = input.createdAt ?? now().toISOString();
  const videoPath = resolveVideoPath(input);
  const outputDir = resolve(
    input.outputDir ?? join(dirname(videoPath), "video-evaluator-analysis"),
  );
  await mkdir(outputDir, { recursive: true });

  const subject = normalizeVideoSubject(input, videoPath, outputDir);
  const options = normalizeAnalyzerOptions(input.options);
  const capabilities = effectiveCapabilities(
    input.capabilities,
    DEFAULT_VIDEO_CAPABILITIES,
    options,
  );
  const parts: MutableReportParts = {
    metrics: {},
    artifacts: [...input.artifacts],
    diagnostics: [],
    captionArtifacts: [],
    metadata: { capabilities: [...capabilities] },
  };
  const rawRequest = buildAnalyzerRequest({
    input,
    subject,
    outputDir,
    capabilities,
  });

  let rawProbe: RawMediaProbeArtifact | undefined;
  if (capabilities.has("media-probe")) {
    rawProbe = await runMediaProbe({
      videoPath,
      outputDir,
      now,
      parts,
      probe: dependencies.probeMedia ?? probeMedia,
    });
  }

  if (capabilities.has("quality-gates")) {
    await runQualityGates({
      rawProbe,
      outputDir,
      subject,
      now,
      parts,
      policy: options.qualityPolicy,
      evaluator:
        dependencies.evaluateRenderQualityGates ?? evaluateRenderQualityGates,
    });
  }

  if (capabilities.has("caption-artifacts")) {
    await runCaptionArtifacts({
      outputDir,
      subject,
      now,
      parts,
      options,
    });
  }

  if (shouldRunVideoTechnicalReview(options)) {
    await runTechnicalReview({
      videoPath,
      outputDir,
      parts,
      options,
      reviewer: dependencies.reviewVideoTechnical ?? reviewVideoTechnical,
    });
  }

  const report = buildAnalyzerReport({
    createdAt,
    completedAt: now().toISOString(),
    request: rawRequest,
    subject,
    parts,
  });
  const reportPath = join(outputDir, "analyzer.report.json");
  await writeJson(reportPath, report);
  return { ...report, reportPath };
}

export async function analyzeBundle(
  request: AnalyzeBundleRequest,
  dependencies: AnalyzeVideoDependencies = {},
): Promise<AnalyzerReport & { reportPath: string; bundle: BundleArtifactMap }> {
  const input = AnalyzeBundleRequestSchema.parse(request);
  const now = dependencies.now ?? (() => new Date());
  const bundle = await intakeBundle(input);
  const outputDir = resolve(
    input.analysisOutputDir ?? bundle.rootDir ?? input.outputDir ?? process.cwd(),
  );
  await mkdir(outputDir, { recursive: true });

  const capabilities = new Set(
    input.capabilities.length > 0
      ? input.capabilities
      : DEFAULT_BUNDLE_CAPABILITIES,
  );
  const subject: AnalyzerSubject = {
    kind: "bundle",
    bundleDir: bundle.rootDir ?? outputDir,
    ...(bundle.videoPath ? { videoPath: bundle.videoPath } : {}),
    outputDir,
  };
  const artifacts = [
    ...input.artifacts,
    ...Object.entries(bundle.artifacts).map(([name, path]) =>
      artifactReference(name, path),
    ),
  ];

  if (capabilities.has("review-bundle")) {
    const reviewBundlePath = join(outputDir, "review-bundle.json");
    await writeJson(reviewBundlePath, {
      schemaVersion: "review-bundle.v1",
      createdAt: input.createdAt ?? now().toISOString(),
      bundle,
    });
    artifacts.push(artifactReference("review-bundle", reviewBundlePath));
  }

  if (!bundle.videoPath) {
    const createdAt = input.createdAt ?? now().toISOString();
    const report = buildAnalyzerReport({
      createdAt,
      completedAt: now().toISOString(),
      request: buildAnalyzerRequest({
        input,
        subject,
        outputDir,
        capabilities,
      }),
      subject,
      parts: {
        metrics: {},
        artifacts,
        diagnostics: [
          diagnostic(
            "bundle-video-missing",
            "No video file could be resolved from the bundle.",
            "error",
          ),
        ],
        captionArtifacts: [],
        metadata: { bundle, capabilities: [...capabilities] },
      },
    });
    const reportPath = join(outputDir, "analyzer.report.json");
    await writeJson(reportPath, report);
    return { ...report, reportPath, bundle };
  }

  const options = normalizeAnalyzerOptions(input.options);
  const captionPath =
    options.captionPath ??
    options.captionSidecarPath ??
    bundle.artifacts["subtitles.vtt"] ??
    bundle.artifacts["subtitles.srt"];
  const captionOcrPath = options.captionOcrPath ?? bundle.artifacts["storyboard.ocr.json"];
  if (captionPath && input.capabilities.length === 0) {
    capabilities.add("caption-artifacts");
  }
  const videoReport = await analyzeVideo(
    {
      schemaVersion: input.schemaVersion,
      requestId: input.requestId,
      createdAt: input.createdAt,
      subject,
      videoPath: bundle.videoPath,
      outputDir,
      capabilities: [...capabilities].filter(
        (capability) => capability !== "review-bundle",
      ),
      artifacts,
      options: {
        ...input.options,
        ...(captionPath ? { captionPath } : {}),
        ...(captionOcrPath ? { captionOcrPath } : {}),
      },
    },
    dependencies,
  );
  return { ...videoReport, bundle };
}

async function runMediaProbe(input: {
  videoPath: string;
  outputDir: string;
  now: Now;
  parts: MutableReportParts;
  probe: typeof probeMedia;
}): Promise<RawMediaProbeArtifact | undefined> {
  try {
    const rawProbe = await input.probe(input.videoPath, { now: input.now });
    const mediaProbe = adaptMediaProbe(rawProbe);
    const path = join(input.outputDir, "media-probe.json");
    await writeJson(path, mediaProbe);
    input.parts.mediaProbe = mediaProbe;
    input.parts.artifacts.push(
      artifactReference("media-probe", path, "media-probe", MEDIA_PROBE_SCHEMA_VERSION),
    );
    addMediaProbeMetrics(input.parts.metrics, mediaProbe);
    return rawProbe;
  } catch (error) {
    input.parts.diagnostics.push(
      diagnostic(
        "media-probe-failed",
        `Media probe failed: ${errorMessage(error)}`,
        "error",
      ),
    );
    return undefined;
  }
}

async function runQualityGates(input: {
  rawProbe: RawMediaProbeArtifact | undefined;
  outputDir: string;
  subject: AnalyzerSubject;
  now: Now;
  parts: MutableReportParts;
  policy: RenderQualityGatePolicy | undefined;
  evaluator: typeof evaluateRenderQualityGates;
}): Promise<void> {
  if (!input.rawProbe) {
    input.parts.diagnostics.push(
      diagnostic(
        "quality-gates-skipped",
        "Quality gates were skipped because media probe data is unavailable.",
        "warning",
      ),
    );
    return;
  }

  const rawGates = input.evaluator(input.rawProbe, input.policy ?? {}, {
    now: input.now,
  });
  const qualityGates = adaptQualityGates(rawGates, input.subject);
  const path = join(input.outputDir, "quality-gates.json");
  await writeJson(path, qualityGates);
  input.parts.qualityGates = qualityGates;
  input.parts.artifacts.push(
    artifactReference("quality-gates", path, "quality-gates", QUALITY_GATES_SCHEMA_VERSION),
  );
}

async function runCaptionArtifacts(input: {
  outputDir: string;
  subject: AnalyzerSubject;
  now: Now;
  parts: MutableReportParts;
  options: AnalyzerOptions;
}): Promise<void> {
  const captionPath = input.options.captionPath ?? input.options.captionSidecarPath;
  if (!captionPath) {
    input.parts.diagnostics.push(
      diagnostic(
        "caption-sidecar-missing",
        "Caption artifact generation was requested, but no caption sidecar path was provided or discovered.",
        "warning",
      ),
    );
    return;
  }

  try {
    const resolvedCaptionPath = resolve(captionPath);
    const sidecar = await readFile(resolvedCaptionPath, "utf8");
    const ocrBoxes =
      input.options.ocrBoxes ??
      (input.options.captionOcrPath
        ? await readCaptionOcrBoxes(input.options.captionOcrPath)
        : undefined);
    const artifact = buildCaptionArtifact({
      sidecar,
      sidecarPath: resolvedCaptionPath,
      ocrBoxes,
      ocrPath: input.options.captionOcrPath,
      subject: input.subject,
      now: input.now,
    });
    const path = join(input.outputDir, "caption-artifact.json");
    await writeJson(path, artifact);
    input.parts.captionArtifacts.push(artifact);
    input.parts.artifacts.push(
      artifactReference(
        "caption-artifact",
        path,
        "caption-artifact",
        CAPTION_ARTIFACT_SCHEMA_VERSION,
      ),
    );
  } catch (error) {
    input.parts.diagnostics.push(
      diagnostic(
        "caption-artifact-failed",
        `Caption artifact generation failed: ${errorMessage(error)}`,
        "error",
      ),
    );
  }
}

async function runTechnicalReview(input: {
  videoPath: string;
  outputDir: string;
  parts: MutableReportParts;
  options: AnalyzerOptions;
  reviewer: typeof reviewVideoTechnical;
}): Promise<void> {
  try {
    const reviewInput = VideoTechnicalReviewRequestSchema.parse({
      videoPath: input.videoPath,
      outputDir: join(input.outputDir, "technical-review"),
      ...(input.options.videoTechnicalReview ?? {}),
    });
    const result = await input.reviewer(reviewInput);
    input.parts.artifacts.push(
      artifactReference(
        "video-technical-report",
        result.reportPath,
        "video-technical-report",
        result.report.schemaVersion,
      ),
    );
    if (result.contactSheetMetadataPath) {
      input.parts.artifacts.push(
        artifactReference(
          "contact-sheet-metadata",
          result.contactSheetMetadataPath,
          "contact-sheet-metadata",
          result.contactSheetMetadata?.schemaVersion,
        ),
      );
    }
    for (const issue of result.report.issues) {
      input.parts.diagnostics.push(diagnosticFromTechnicalIssue(issue));
    }
    input.parts.metrics["technical.sampledFrameCount"] = {
      value: result.report.sampledFrameCount,
      unit: "frames",
      status: result.report.issues.some((issue) => issue.severity === "error")
        ? "fail"
        : result.report.issues.length > 0
          ? "warn"
          : "pass",
    };
    input.parts.metadata.videoTechnicalReview = {
      reportPath: result.reportPath,
      outputDir: defaultVideoTechnicalOutputDir(input.videoPath),
    };
  } catch (error) {
    input.parts.diagnostics.push(
      diagnostic(
        "video-technical-review-failed",
        `Video technical review failed: ${errorMessage(error)}`,
        "error",
      ),
    );
  }
}

function adaptMediaProbe(
  rawProbe: RawMediaProbeArtifact,
): ContractMediaProbeArtifact {
  return {
    schemaVersion: MEDIA_PROBE_SCHEMA_VERSION,
    createdAt: rawProbe.createdAt,
    videoPath: rawProbe.filePath,
    file: {
      path: rawProbe.filePath,
      ...(rawProbe.sizeBytes !== null ? { sizeBytes: rawProbe.sizeBytes } : {}),
    },
    container: {
      ...(rawProbe.container.formatName
        ? { formatName: rawProbe.container.formatName }
        : {}),
      ...(rawProbe.container.formatLongName
        ? { formatLongName: rawProbe.container.formatLongName }
        : {}),
      ...(rawProbe.durationSeconds !== null
        ? { durationSeconds: rawProbe.durationSeconds }
        : {}),
      ...(rawProbe.container.bitRate !== null
        ? { bitRateBitsPerSecond: rawProbe.container.bitRate }
        : {}),
    },
    ...(rawProbe.video?.width && rawProbe.video.height
      ? {
          video: {
            width: rawProbe.video.width,
            height: rawProbe.video.height,
            ...(rawProbe.video.codecName
              ? { codecName: rawProbe.video.codecName }
              : {}),
            ...(rawProbe.video.codecLongName
              ? { codecLongName: rawProbe.video.codecLongName }
              : {}),
            ...(rawProbe.video.pixelFormat
              ? { pixelFormat: rawProbe.video.pixelFormat }
              : {}),
            ...(rawProbe.video.fps
              ? { frameRateFps: rawProbe.video.fps }
              : {}),
            ...(rawProbe.video.durationSeconds !== null
              ? { durationSeconds: rawProbe.video.durationSeconds }
              : {}),
            ...(rawProbe.video.bitRate !== null
              ? { bitRateBitsPerSecond: rawProbe.video.bitRate }
              : {}),
          },
        }
      : {}),
    audio: {
      present: rawProbe.hasAudio,
      ...(rawProbe.audio?.codecName ? { codecName: rawProbe.audio.codecName } : {}),
      ...(rawProbe.audio?.codecLongName
        ? { codecLongName: rawProbe.audio.codecLongName }
        : {}),
      ...(rawProbe.audio?.sampleRateHz
        ? { sampleRateHz: rawProbe.audio.sampleRateHz }
        : {}),
      ...(rawProbe.audio?.channels ? { channels: rawProbe.audio.channels } : {}),
      ...(rawProbe.audio?.durationSeconds !== null &&
      rawProbe.audio?.durationSeconds !== undefined
        ? { durationSeconds: rawProbe.audio.durationSeconds }
        : {}),
      ...(rawProbe.audio?.bitRate !== null && rawProbe.audio?.bitRate !== undefined
        ? { bitRateBitsPerSecond: rawProbe.audio.bitRate }
        : {}),
    },
    artifacts: [],
    diagnostics: [],
    probeTool: { name: "ffprobe" },
    metadata: { sourceSchema: rawProbe.schema },
  };
}

function adaptQualityGates(
  rawGates: QualityGatesArtifact,
  subject: AnalyzerSubject,
): QualityGateReport {
  const gates: QualityGateResult[] = rawGates.checks.map((check) => {
    const metrics: Record<string, MetricValue> = {};
    const actual = metricPrimitive(check.actual);
    if (actual !== undefined) {
      metrics.actual = {
        value: actual,
        ...(metricPrimitive(check.expected) !== undefined
          ? { threshold: metricPrimitive(check.expected) }
          : {}),
        status: mapQualityStatus(check.status),
      };
    }
    return {
      id: check.id,
      name: check.label,
      status: mapQualityStatus(check.status),
      severity: check.severity === "error" ? "error" : "warning",
      message: check.message,
      metrics,
      evidence: [],
      diagnostics: [],
      metadata: {
        actual: check.actual,
        expected: check.expected,
        sourceSeverity: check.severity,
      },
    };
  });
  return {
    schemaVersion: QUALITY_GATES_SCHEMA_VERSION,
    createdAt: rawGates.createdAt,
    subject,
    overallStatus: mapQualityStatus(rawGates.status),
    gates,
    artifacts: [],
    diagnostics: [],
    metadata: { sourceSchema: rawGates.schema },
  };
}

function buildCaptionArtifact(input: {
  sidecar: CaptionSidecarSource;
  sidecarPath: string;
  ocrBoxes: CaptionOcrBox[] | undefined;
  ocrPath: string | undefined;
  subject: AnalyzerSubject;
  now: Now;
}): CaptionArtifact {
  const createdAt = input.now().toISOString();
  const cues = parseCaptionSidecar(input.sidecar);
  const quality = reviewCaptionQuality(cues, { createdAt });
  const ocr = reviewCaptionOcr(input.sidecar, input.ocrBoxes, { createdAt });
  const sync = reviewCaptionSync(input.sidecar, input.ocrBoxes, { createdAt });
  const issues = [...quality.issues, ...ocr.issues, ...sync.issues];
  const status = statusFromCaptionIssues(issues);
  return {
    schemaVersion: CAPTION_ARTIFACT_SCHEMA_VERSION,
    createdAt,
    subject: input.subject,
    trackFormat: captionTrackFormat(input.sidecarPath),
    cues: cues.map((cue) => adaptCaptionCue(cue, "sidecar")),
    expectedCues: cues.map((cue) => adaptCaptionCue(cue, "expected")),
    ocrCues: [],
    summary: {
      status,
      cueCount: cues.length,
      readableCueShare: quality.metrics.readabilityPassRatio,
      syncOffsetSecondsP50: sync.metrics.averageAbsDriftSeconds,
      syncOffsetSecondsP95: sync.metrics.maxAbsDriftSeconds,
      metrics: {
        captionedSeconds: {
          value: quality.metrics.captionedSeconds,
          unit: "s",
        },
        averageCharsPerSecond: {
          value: quality.metrics.averageCharsPerSecond,
          unit: "chars/s",
          status: quality.issues.length > 0 ? "warn" : "pass",
        },
      },
      notes: issues.map((issue) => issue.message),
    },
    artifacts: [
      artifactReference("caption-sidecar", input.sidecarPath),
      ...(input.ocrPath ? [artifactReference("caption-ocr-source", input.ocrPath)] : []),
    ],
    evidence: [],
    diagnostics: issues.map(diagnosticFromCaptionIssue),
    metadata: {
      quality,
      ocr,
      sync,
    },
  };
}

async function readCaptionOcrBoxes(path: string): Promise<CaptionOcrBox[]> {
  const resolved = resolve(path);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return [];
  const frames = (parsed as { frames?: unknown }).frames;
  if (!Array.isArray(frames)) return [];
  const boxes: CaptionOcrBox[] = [];
  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    const record = frame as Record<string, unknown>;
    const lines = Array.isArray(record.lines) ? record.lines : [];
    for (const [index, line] of lines.entries()) {
      if (!line || typeof line !== "object") continue;
      const lineRecord = line as Record<string, unknown>;
      const text = typeof lineRecord.text === "string" ? lineRecord.text : "";
      if (!text.trim()) continue;
      const bbox = normalizeStoryboardBbox(lineRecord.bbox);
      boxes.push({
        id: `frame-${String(record.index ?? boxes.length + 1)}-line-${index + 1}`,
        timestampSeconds: numberOrUndefined(record.timestampSeconds),
        text,
        confidence: ratioConfidence(lineRecord.confidence),
        region: typeof lineRecord.region === "string" ? lineRecord.region : undefined,
        imageWidth: numberOrUndefined(record.imageWidth),
        imageHeight: numberOrUndefined(record.imageHeight),
        ...(bbox ? { box: bbox } : {}),
      });
    }
  }
  return boxes;
}

function normalizeVideoSubject(
  input: AnalyzeVideoRequest,
  videoPath: string,
  outputDir: string,
): AnalyzerSubject {
  if (input.subject) return input.subject;
  return {
    kind: "video",
    videoPath,
    outputDir,
  };
}

function resolveVideoPath(input: AnalyzeVideoRequest): string {
  const subject = input.subject;
  const candidate =
    input.videoPath ??
    (subject?.kind !== "comparison" ? subject?.videoPath : undefined);
  if (!candidate) {
    throw new Error("videoPath or subject.videoPath is required");
  }
  return resolve(candidate);
}

function buildAnalyzerRequest(input: {
  input: AnalyzeVideoRequest | AnalyzeBundleRequest;
  subject: AnalyzerSubject;
  outputDir: string;
  capabilities: Set<AnalyzerCapability>;
}): AnalyzerRequest {
  return {
    schemaVersion: ANALYZER_REQUEST_SCHEMA_VERSION,
    requestId: input.input.requestId,
    createdAt: input.input.createdAt,
    subject: input.subject,
    capabilities: [...input.capabilities],
    outputDir: input.outputDir,
    artifacts: input.input.artifacts,
    options: input.input.options,
  };
}

function buildAnalyzerReport(input: {
  createdAt: string;
  completedAt: string;
  request: AnalyzerRequest;
  subject: AnalyzerSubject;
  parts: MutableReportParts;
}): AnalyzerReport {
  return {
    schemaVersion: ANALYZER_REPORT_SCHEMA_VERSION,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    request: input.request,
    subject: input.subject,
    status: collapseReportStatus(input.parts),
    metrics: input.parts.metrics,
    mediaProbe: input.parts.mediaProbe,
    qualityGates: input.parts.qualityGates,
    captionArtifacts: input.parts.captionArtifacts,
    visualDiffs: [],
    artifacts: dedupeArtifacts(input.parts.artifacts),
    diagnostics: input.parts.diagnostics,
    metadata: input.parts.metadata,
  };
}

function effectiveCapabilities(
  requested: AnalyzerCapability[],
  defaults: AnalyzerCapability[],
  options: AnalyzerOptions,
): Set<AnalyzerCapability> {
  const capabilities = new Set(requested.length > 0 ? requested : defaults);
  if ((options.captionPath || options.captionSidecarPath) && requested.length === 0) {
    capabilities.add("caption-artifacts");
  }
  return capabilities;
}

function normalizeAnalyzerOptions(options: Record<string, unknown>): AnalyzerOptions {
  return {
    qualityPolicy:
      options.qualityPolicy && typeof options.qualityPolicy === "object"
        ? (options.qualityPolicy as RenderQualityGatePolicy)
        : undefined,
    captionPath: stringOption(options.captionPath),
    captionSidecarPath: stringOption(options.captionSidecarPath),
    captionOcrPath: stringOption(options.captionOcrPath),
    ocrBoxes: Array.isArray(options.ocrBoxes)
      ? (options.ocrBoxes as CaptionOcrBox[])
      : undefined,
    runVideoTechnicalReview:
      typeof options.runVideoTechnicalReview === "boolean"
        ? options.runVideoTechnicalReview
        : undefined,
    videoTechnicalReview:
      options.videoTechnicalReview && typeof options.videoTechnicalReview === "object"
        ? (options.videoTechnicalReview as Partial<VideoTechnicalReviewRequest>)
        : undefined,
  };
}

function shouldRunVideoTechnicalReview(options: AnalyzerOptions): boolean {
  return options.runVideoTechnicalReview ?? true;
}

function addMediaProbeMetrics(
  metrics: Record<string, MetricValue>,
  mediaProbe: ContractMediaProbeArtifact,
): void {
  if (mediaProbe.container.durationSeconds !== undefined) {
    metrics.durationSeconds = {
      value: mediaProbe.container.durationSeconds,
      unit: "s",
    };
  }
  if (mediaProbe.video?.width && mediaProbe.video.height) {
    metrics.width = { value: mediaProbe.video.width, unit: "px" };
    metrics.height = { value: mediaProbe.video.height, unit: "px" };
  }
  if (mediaProbe.video?.frameRateFps !== undefined) {
    metrics.frameRateFps = {
      value: mediaProbe.video.frameRateFps,
      unit: "fps",
    };
  }
}

function collapseReportStatus(parts: MutableReportParts): ContractStatus {
  if (
    parts.diagnostics.some(
      (entry) => entry.severity === "error" || entry.severity === "critical",
    ) ||
    parts.qualityGates?.overallStatus === "fail"
  ) {
    return "fail";
  }
  if (
    parts.diagnostics.some((entry) => entry.severity === "warning") ||
    parts.qualityGates?.overallStatus === "warn" ||
    parts.captionArtifacts.some((artifact) => artifact.summary.status === "warn")
  ) {
    return "warn";
  }
  if (parts.artifacts.length > 0 || parts.mediaProbe || parts.qualityGates) return "pass";
  return "unknown";
}

function statusFromCaptionIssues(issues: CaptionIssue[]): ContractStatus {
  if (issues.some((issue) => issue.severity === "fail")) return "fail";
  if (issues.some((issue) => issue.severity === "warn")) return "warn";
  return "pass";
}

function mapQualityStatus(status: "pass" | "warn" | "fail"): ContractStatus {
  return status;
}

function adaptCaptionCue(
  cue: CaptionCue,
  source: "sidecar" | "expected",
): ContractCaptionCue {
  return {
    id: cue.id,
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    text: cue.text,
    source: source === "expected" ? "expected" : "sidecar",
    metadata: {
      ...(cue.region ? { region: cue.region } : {}),
      ...(cue.lines ? { lines: cue.lines } : {}),
      ...(cue.metadata ? cue.metadata : {}),
    },
  };
}

function diagnosticFromCaptionIssue(issue: CaptionIssue): ContractDiagnostic {
  return diagnostic(
    `caption-${issue.code}`,
    issue.message,
    issue.severity === "fail" ? "error" : issue.severity === "warn" ? "warning" : "info",
    {
      ...(issue.cueId ? { cueId: issue.cueId } : {}),
      ...(issue.ocrBoxId ? { ocrBoxId: issue.ocrBoxId } : {}),
      ...(issue.value !== undefined ? { value: issue.value } : {}),
      ...(issue.threshold !== undefined ? { threshold: issue.threshold } : {}),
    },
  );
}

function diagnosticFromTechnicalIssue(issue: VideoTechnicalIssue): ContractDiagnostic {
  return diagnostic(
    `technical-${issue.code}`,
    issue.message,
    issue.severity === "error"
      ? "error"
      : issue.severity === "warning"
        ? "warning"
        : "info",
    issue.details,
  );
}

function diagnostic(
  code: string,
  message: string,
  severity: ContractDiagnostic["severity"],
  metadata?: Record<string, unknown>,
): ContractDiagnostic {
  return {
    code,
    message,
    severity,
    evidence: [],
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function artifactReference(
  name: string,
  path: string,
  role?: string,
  schemaVersion?: string | number,
): ArtifactReference {
  return {
    name,
    path: resolve(path),
    ...(role ? { role } : {}),
    ...(schemaVersion ? { schemaVersion } : {}),
  };
}

function dedupeArtifacts(artifacts: ArtifactReference[]): ArtifactReference[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.name}\0${artifact.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function metricPrimitive(
  value: unknown,
): MetricValue["value"] | MetricValue["threshold"] | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function normalizeStoryboardBbox(value: unknown): CaptionOcrBox["box"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const x0 = numberOrUndefined(record.x0);
  const y0 = numberOrUndefined(record.y0);
  const width = numberOrUndefined(record.width);
  const height = numberOrUndefined(record.height);
  if (
    x0 === undefined ||
    y0 === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }
  return { x: x0, y: y0, width, height };
}

function ratioConfidence(value: unknown): number | undefined {
  const number = numberOrUndefined(value);
  if (number === undefined) return undefined;
  return number > 1 ? number / 100 : number;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function captionTrackFormat(path: string): CaptionArtifact["trackFormat"] {
  const ext = extname(path).toLowerCase();
  if (ext === ".vtt" || ext === ".webvtt") return "webvtt";
  if (ext === ".srt") return "srt";
  if (ext === ".ass") return "ass";
  if (ext === ".json") return "json";
  return "unknown";
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export {
  AnalyzeBundleRequestSchema,
  AnalyzeVideoRequestSchema,
  type AnalyzeBundleRequest,
  type AnalyzeVideoRequest,
};
