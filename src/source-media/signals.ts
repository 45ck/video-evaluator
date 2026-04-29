import { execFile } from "node:child_process";
import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SourceMediaSignalsRequest } from "../core/schemas.js";
import { extractVideoShots, type VideoShotsManifest } from "../core/video-shots.js";
import { probeMedia, type MediaProbeArtifact } from "../probe/media.js";

const execFileAsync = promisify(execFile);

export const SOURCE_MEDIA_SIGNALS_SCHEMA_VERSION = "source-media-signals.v1" as const;

export type SourceMediaEvidenceStatus =
  | "available"
  | "unavailable"
  | "skipped"
  | "failed"
  | "placeholder";

export interface SourceMediaSilenceSegment {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface SourceMediaAudioSignals {
  status: SourceMediaEvidenceStatus;
  hasAudio: boolean;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  silenceThresholdDb: number;
  minSilenceDurationSeconds: number;
  silenceSegments: SourceMediaSilenceSegment[];
  totalSilenceSeconds: number | null;
  silentShare: number | null;
  diagnostic?: string;
}

export interface SourceMediaShotSummary {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestampSeconds: number;
  representativeFramePath?: string;
}

export interface SourceMediaVideoSignals {
  status: SourceMediaEvidenceStatus;
  hasVideo: boolean;
  shotManifestPath: string | null;
  sceneThreshold: number;
  minShotDurationSeconds: number;
  shotCount: number;
  detectedBoundaryCount: number | null;
  shots: SourceMediaShotSummary[];
  diagnostic?: string;
}

export interface SourceMediaRepresentativeFrames {
  status: SourceMediaEvidenceStatus;
  framePaths: string[];
  diagnostic?: string;
}

export type SourceMediaTextRiskLevel = "low" | "medium" | "high" | "unknown";
export type SourceMediaTextRiskEvidenceSource = "ocr" | "layout" | "frames" | "video";
export type SourceMediaTextRiskEvidenceSeverity = "info" | "warning" | "error";

export interface SourceMediaTextRiskEvidence {
  source: SourceMediaTextRiskEvidenceSource;
  kind: string;
  severity: SourceMediaTextRiskEvidenceSeverity;
  message: string;
  artifactPath?: string;
  framePath?: string;
  frameIndex?: number;
  timestampSeconds?: number;
  text?: string;
  confidence?: number;
  details?: Record<string, unknown>;
}

export interface SourceMediaTextRiskSignals {
  status: SourceMediaEvidenceStatus;
  riskLevel: SourceMediaTextRiskLevel;
  evidence: SourceMediaTextRiskEvidence[];
  artifacts: {
    ocrPath: string | null;
    layoutReportPath: string | null;
    layoutPath: string | null;
    framePaths: string[];
  };
  metrics: {
    ocrFrameCount: number;
    ocrTextLineCount: number;
    lowConfidenceLineCount: number;
    bottomRegionLineCount: number;
    layoutIssueCount: number;
    fallbackFrameCount: number;
  };
  diagnostic?: string;
}

export interface SourceMediaSignalsManifest {
  schemaVersion: typeof SOURCE_MEDIA_SIGNALS_SCHEMA_VERSION;
  createdAt: string;
  videoPath: string;
  outputDir: string;
  ffprobe: {
    status: "available";
    facts: MediaProbeArtifact;
  };
  audio: SourceMediaAudioSignals;
  video: SourceMediaVideoSignals;
  representativeFrames: SourceMediaRepresentativeFrames;
  textRisk: SourceMediaTextRiskSignals;
}

export interface SourceMediaSignalsResult {
  manifestPath: string;
  manifest: SourceMediaSignalsManifest;
}

export interface SourceMediaSignalsOptions {
  now?: () => Date;
  probe?: (videoPath: string) => Promise<MediaProbeArtifact>;
  analyzeAudio?: (
    videoPath: string,
    input: SourceMediaSignalsRequest,
    probe: MediaProbeArtifact,
  ) => Promise<SourceMediaAudioSignals>;
  extractShots?: (input: SourceMediaSignalsRequest) => Promise<{
    manifestPath: string;
    manifest: VideoShotsManifest;
  }>;
  collectTextRisk?: (input: {
    videoPath: string;
    outputDir: string;
    probe: MediaProbeArtifact;
    video: SourceMediaVideoSignals;
    representativeFrames: SourceMediaRepresentativeFrames;
  }) => Promise<SourceMediaTextRiskSignals>;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface AnalyzeAudioSignalsOptions {
  execFile?: (file: string, args: string[]) => Promise<ExecFileResult>;
  ffmpegPath?: string;
}

export async function buildSourceMediaSignals(
  input: SourceMediaSignalsRequest,
  options: SourceMediaSignalsOptions = {},
): Promise<SourceMediaSignalsResult> {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? dirname(videoPath));
  const manifestPath = resolve(input.outputPath ?? join(outputDir, "source-media.signals.json"));
  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });

  const probe = await (options.probe ?? probeMedia)(videoPath);
  const audio = !input.runAudioSignals
    ? skippedAudioSignals(input, probe, "audio signal analysis disabled by request")
    : !probe.hasAudio
      ? unavailableAudioSignals(input)
      : await (options.analyzeAudio ?? analyzeAudioSignals)(videoPath, input, probe);
  const shotResult = await collectVideoSignals(input, probe, options.extractShots);
  const textRisk = await (options.collectTextRisk ?? collectTextRiskSignals)({
    videoPath,
    outputDir,
    probe,
    video: shotResult.video,
    representativeFrames: shotResult.representativeFrames,
  });
  const manifest: SourceMediaSignalsManifest = {
    schemaVersion: SOURCE_MEDIA_SIGNALS_SCHEMA_VERSION,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    videoPath,
    outputDir,
    ffprobe: {
      status: "available",
      facts: probe,
    },
    audio,
    video: shotResult.video,
    representativeFrames: shotResult.representativeFrames,
    textRisk,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest };
}

export async function analyzeAudioSignals(
  videoPath: string,
  input: SourceMediaSignalsRequest,
  probe: MediaProbeArtifact,
  options: AnalyzeAudioSignalsOptions = {},
): Promise<SourceMediaAudioSignals> {
  if (!probe.hasAudio) {
    return unavailableAudioSignals(input);
  }

  const runner = options.execFile ?? defaultExecFile;
  try {
    const { stderr } = await runner(options.ffmpegPath ?? "ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      videoPath,
      "-af",
      `volumedetect,silencedetect=noise=${input.silenceNoiseDb}dB:d=${input.silenceMinDurationSeconds}`,
      "-vn",
      "-f",
      "null",
      "-",
    ]);
    return parseAudioSignals(stderr, probe.durationSeconds, input);
  } catch (error) {
    const classified = classifyToolError(error);
    return {
      status: classified.status,
      hasAudio: true,
      meanVolumeDb: null,
      maxVolumeDb: null,
      silenceThresholdDb: input.silenceNoiseDb,
      minSilenceDurationSeconds: input.silenceMinDurationSeconds,
      silenceSegments: [],
      totalSilenceSeconds: null,
      silentShare: null,
      diagnostic: classified.diagnostic,
    };
  }
}

export function parseAudioSignals(
  stderr: string,
  durationSeconds: number | null,
  input: Pick<SourceMediaSignalsRequest, "silenceNoiseDb" | "silenceMinDurationSeconds">,
): SourceMediaAudioSignals {
  const meanVolumeDb = parseDbValue(stderr, /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/);
  const maxVolumeDb = parseDbValue(stderr, /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/);
  const silenceSegments = parseSilenceSegments(stderr, durationSeconds);
  const totalSilenceSeconds = roundSeconds(
    silenceSegments.reduce((total, segment) => total + segment.durationSeconds, 0),
  );
  const silentShare =
    durationSeconds && durationSeconds > 0 ? roundRatio(totalSilenceSeconds / durationSeconds) : null;

  return {
    status: "available",
    hasAudio: true,
    meanVolumeDb,
    maxVolumeDb,
    silenceThresholdDb: input.silenceNoiseDb,
    minSilenceDurationSeconds: input.silenceMinDurationSeconds,
    silenceSegments,
    totalSilenceSeconds,
    silentShare,
  };
}

async function collectVideoSignals(
  input: SourceMediaSignalsRequest,
  probe: MediaProbeArtifact,
  extractShotsOverride?: SourceMediaSignalsOptions["extractShots"],
): Promise<{
  video: SourceMediaVideoSignals;
  representativeFrames: SourceMediaRepresentativeFrames;
}> {
  if (!probe.hasVideo) {
    return {
      video: {
        status: "unavailable",
        hasVideo: false,
        shotManifestPath: null,
        sceneThreshold: input.sceneThreshold,
        minShotDurationSeconds: input.minShotDurationSeconds,
        shotCount: 0,
        detectedBoundaryCount: null,
        shots: [],
        diagnostic: "ffprobe found no video stream",
      },
      representativeFrames: {
        status: "unavailable",
        framePaths: [],
        diagnostic: "ffprobe found no video stream",
      },
    };
  }

  if (!input.runVideoShots) {
    return {
      video: {
        status: "skipped",
        hasVideo: true,
        shotManifestPath: null,
        sceneThreshold: input.sceneThreshold,
        minShotDurationSeconds: input.minShotDurationSeconds,
        shotCount: 0,
        detectedBoundaryCount: null,
        shots: [],
        diagnostic: "video shot analysis disabled by request",
      },
      representativeFrames: {
        status: "skipped",
        framePaths: [],
        diagnostic: "video shot analysis disabled by request",
      },
    };
  }

  const extractShots = extractShotsOverride ?? defaultExtractShots;
  try {
    const result = await extractShots(input);
    return availableVideoSignals(input, result.manifestPath, result.manifest);
  } catch (error) {
    if (input.extractRepresentativeFrames) {
      try {
        const result = await extractShots({ ...input, extractRepresentativeFrames: false });
        const signals = availableVideoSignals(input, result.manifestPath, result.manifest);
        return {
          video: signals.video,
          representativeFrames: {
            status: "failed",
            framePaths: [],
            diagnostic: `representative frame extraction failed; shot estimates recovered without frames: ${formatError(error)}`,
          },
        };
      } catch (retryError) {
        return failedVideoSignals(input, retryError);
      }
    }
    return failedVideoSignals(input, error);
  }
}

function availableVideoSignals(
  input: SourceMediaSignalsRequest,
  shotManifestPath: string,
  manifest: VideoShotsManifest,
): {
  video: SourceMediaVideoSignals;
  representativeFrames: SourceMediaRepresentativeFrames;
} {
  const shots = manifest.shots.map((shot) => ({
    index: shot.index,
    startSeconds: shot.startSeconds,
    endSeconds: shot.endSeconds,
    durationSeconds: shot.durationSeconds,
    representativeTimestampSeconds: shot.representativeTimestampSeconds,
    ...(shot.representativeFramePath ? { representativeFramePath: shot.representativeFramePath } : {}),
  }));
  const framePaths = shots
    .map((shot) => shot.representativeFramePath)
    .filter((path): path is string => Boolean(path));
  return {
    video: {
      status: "available",
      hasVideo: true,
      shotManifestPath,
      sceneThreshold: manifest.sceneThreshold,
      minShotDurationSeconds: manifest.minShotDurationSeconds,
      shotCount: manifest.shots.length,
      detectedBoundaryCount: manifest.detectedBoundaryCount,
      shots,
    },
    representativeFrames: {
      status: framePaths.length > 0 ? "available" : input.extractRepresentativeFrames ? "failed" : "skipped",
      framePaths,
      ...(framePaths.length === 0 && input.extractRepresentativeFrames
        ? { diagnostic: "shot extraction completed but no representative frame paths were emitted" }
        : {}),
    },
  };
}

function failedVideoSignals(
  input: SourceMediaSignalsRequest,
  error: unknown,
): {
  video: SourceMediaVideoSignals;
  representativeFrames: SourceMediaRepresentativeFrames;
} {
  const classified = classifyToolError(error);
  return {
    video: {
      status: classified.status,
      hasVideo: true,
      shotManifestPath: null,
      sceneThreshold: input.sceneThreshold,
      minShotDurationSeconds: input.minShotDurationSeconds,
      shotCount: 0,
      detectedBoundaryCount: null,
      shots: [],
      diagnostic: classified.diagnostic,
    },
    representativeFrames: {
      status: classified.status,
      framePaths: [],
      diagnostic: classified.diagnostic,
    },
  };
}

interface TextRiskInput {
  videoPath: string;
  outputDir: string;
  probe: MediaProbeArtifact;
  video: SourceMediaVideoSignals;
  representativeFrames: SourceMediaRepresentativeFrames;
}

interface OcrLineRecord {
  text?: unknown;
  confidence?: unknown;
  region?: unknown;
  bbox?: unknown;
}

interface OcrFrameRecord {
  index?: unknown;
  timestampSeconds?: unknown;
  lines?: OcrLineRecord[];
  semanticLines?: OcrLineRecord[];
  quality?: {
    status?: unknown;
    reasons?: unknown;
  };
}

interface LayoutIssueRecord {
  severity?: unknown;
  code?: unknown;
  message?: unknown;
  timeSeconds?: unknown;
  details?: unknown;
}

export async function collectTextRiskSignals(input: TextRiskInput): Promise<SourceMediaTextRiskSignals> {
  if (!input.probe.hasVideo) {
    return {
      status: "unavailable",
      riskLevel: "unknown",
      evidence: [
        {
          source: "video",
          kind: "no-video-stream",
          severity: "info",
          message: "ffprobe found no video stream, so visible text/caption risk cannot be assessed.",
        },
      ],
      artifacts: emptyTextRiskArtifacts(),
      metrics: emptyTextRiskMetrics(),
      diagnostic: "ffprobe found no video stream",
    };
  }

  const artifactPaths = await discoverTextRiskArtifacts(input);
  const evidence: SourceMediaTextRiskEvidence[] = [];
  const metrics = emptyTextRiskMetrics();

  if (artifactPaths.ocrPath) {
    const ocr = await readJson<{ frames?: OcrFrameRecord[] }>(artifactPaths.ocrPath);
    const frames = Array.isArray(ocr.frames) ? ocr.frames : [];
    metrics.ocrFrameCount = frames.length;
    evidence.push(...collectOcrTextRiskEvidence(frames, artifactPaths.ocrPath, metrics));
  }

  if (artifactPaths.layoutReportPath) {
    const report = await readJson<{ issues?: LayoutIssueRecord[]; metrics?: Record<string, unknown> }>(
      artifactPaths.layoutReportPath,
    );
    const issues = Array.isArray(report.issues) ? report.issues : [];
    metrics.layoutIssueCount = issues.length;
    evidence.push(...collectLayoutRiskEvidence(issues, artifactPaths.layoutReportPath));
  }

  if (artifactPaths.layoutPath && !artifactPaths.layoutReportPath) {
    evidence.push({
      source: "layout",
      kind: "layout-annotations-present",
      severity: "info",
      message: "Layout annotations were found, but no layout safety report was available.",
      artifactPath: artifactPaths.layoutPath,
    });
  }

  if (evidence.length === 0) {
    const fallback = fallbackTextRiskEvidence(input);
    metrics.fallbackFrameCount = fallback.filter((item) => item.source === "frames").length;
    evidence.push(...fallback);
  }

  return {
    status: artifactPaths.ocrPath || artifactPaths.layoutReportPath || artifactPaths.layoutPath ? "available" : "unavailable",
    riskLevel: classifyTextRisk(evidence),
    evidence,
    artifacts: {
      ocrPath: artifactPaths.ocrPath,
      layoutReportPath: artifactPaths.layoutReportPath,
      layoutPath: artifactPaths.layoutPath,
      framePaths: input.representativeFrames.framePaths,
    },
    metrics,
    ...(artifactPaths.ocrPath || artifactPaths.layoutReportPath || artifactPaths.layoutPath
      ? {}
      : { diagnostic: "No OCR or layout artifacts were found; deterministic frame/video fallback evidence was recorded." }),
  };
}

function collectOcrTextRiskEvidence(
  frames: OcrFrameRecord[],
  artifactPath: string,
  metrics: SourceMediaTextRiskSignals["metrics"],
): SourceMediaTextRiskEvidence[] {
  const evidence: SourceMediaTextRiskEvidence[] = [];
  const seen = new Set<string>();

  for (const frame of frames) {
    const lines = frameLines(frame);
    const timestampSeconds = numberOrUndefined(frame.timestampSeconds);
    const frameIndex = integerOrUndefined(frame.index);
    if (frame.quality?.status === "reject") {
      evidence.push({
        source: "ocr",
        kind: "ocr-frame-rejected",
        severity: "warning",
        message: "OCR frame quality was rejected, so visible text evidence may be unreliable.",
        artifactPath,
        frameIndex,
        timestampSeconds,
        details: {
          reasons: Array.isArray(frame.quality.reasons) ? frame.quality.reasons : [],
        },
      });
    }

    for (const line of lines) {
      const text = normalizeTextValue(line.text);
      if (!text) continue;
      metrics.ocrTextLineCount++;
      const confidence = numberOrUndefined(line.confidence);
      const region = typeof line.region === "string" ? line.region : undefined;
      if (confidence !== undefined && confidence < 55) metrics.lowConfidenceLineCount++;
      if (region === "bottom") metrics.bottomRegionLineCount++;

      const key = `${text.toLowerCase()}:${region ?? ""}`;
      if (seen.has(key) || evidence.length >= 24) continue;
      seen.add(key);
      evidence.push({
        source: "ocr",
        kind: region === "bottom" ? "caption-or-bottom-text-detected" : "visible-source-text-detected",
        severity: confidence !== undefined && confidence < 55 ? "warning" : "info",
        message:
          region === "bottom"
            ? "OCR detected bottom-region text that may be captions or overlays."
            : "OCR detected visible source text.",
        artifactPath,
        frameIndex,
        timestampSeconds,
        text,
        confidence,
        details: {
          ...(region ? { region } : {}),
          ...(line.bbox ? { bbox: line.bbox } : {}),
        },
      });
    }
  }

  if (frames.length > 0 && metrics.ocrTextLineCount === 0) {
    evidence.push({
      source: "ocr",
      kind: "ocr-no-text-lines",
      severity: "info",
      message: "OCR artifact was present, but no visible text lines were detected.",
      artifactPath,
    });
  }

  return evidence;
}

function collectLayoutRiskEvidence(
  issues: LayoutIssueRecord[],
  artifactPath: string,
): SourceMediaTextRiskEvidence[] {
  return issues.slice(0, 24).map((issue) => ({
    source: "layout",
    kind: typeof issue.code === "string" ? issue.code : "layout-issue",
    severity: layoutSeverity(issue.severity),
    message: typeof issue.message === "string" ? issue.message : "Layout safety issue was reported.",
    artifactPath,
    timestampSeconds: numberOrUndefined(issue.timeSeconds),
    details: isRecord(issue.details) ? issue.details : undefined,
  }));
}

function fallbackTextRiskEvidence(input: TextRiskInput): SourceMediaTextRiskEvidence[] {
  if (input.representativeFrames.framePaths.length > 0) {
    return input.representativeFrames.framePaths.slice(0, 8).map((framePath, index) => ({
      source: "frames",
      kind: "representative-frame-needs-text-review",
      severity: "info",
      message: "Representative frame is available for manual text/caption review, but OCR/layout evidence was not found.",
      framePath,
      frameIndex: input.video.shots[index]?.index,
      timestampSeconds: input.video.shots[index]?.representativeTimestampSeconds,
    }));
  }

  return [
    {
      source: "video",
      kind: "no-text-artifacts",
      severity: "info",
      message: "No OCR, layout, or representative frame artifacts were found for text/caption review.",
      details: {
        shotCount: input.video.shotCount,
        videoStatus: input.video.status,
        representativeFrameStatus: input.representativeFrames.status,
      },
    },
  ];
}

async function discoverTextRiskArtifacts(input: TextRiskInput): Promise<{
  ocrPath: string | null;
  layoutReportPath: string | null;
  layoutPath: string | null;
}> {
  const roots = uniquePaths([input.outputDir, dirname(input.videoPath)]);
  const ocrCandidates = roots.flatMap((root) => [
    join(root, "storyboard.ocr.json"),
    join(root, "storyboard", "storyboard.ocr.json"),
    join(root, "video-evaluator-layout-safety", "storyboard", "storyboard.ocr.json"),
  ]);
  const layoutReportCandidates = roots.flatMap((root) => [
    join(root, "layout-safety.report.json"),
    join(root, "video-evaluator-layout-safety", "layout-safety.report.json"),
  ]);
  const layoutCandidates = roots.flatMap((root) => [
    join(root, "layout.json"),
    join(root, "video.layout.json"),
    join(root, "final.layout.json"),
    join(root, "output.layout.json"),
  ]);

  return {
    ocrPath: await firstExistingPath(ocrCandidates),
    layoutReportPath: await firstExistingPath(layoutReportCandidates),
    layoutPath: await firstExistingPath(layoutCandidates),
  };
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const path of uniquePaths(paths).map((path) => resolve(path))) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue looking for optional artifacts.
    }
  }
  return null;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function frameLines(frame: OcrFrameRecord): OcrLineRecord[] {
  const semanticLines = Array.isArray(frame.semanticLines) ? frame.semanticLines : [];
  const lines = Array.isArray(frame.lines) ? frame.lines : [];
  return semanticLines.length > 0 ? semanticLines : lines;
}

function classifyTextRisk(evidence: SourceMediaTextRiskEvidence[]): SourceMediaTextRiskLevel {
  if (evidence.some((item) => item.severity === "error")) return "high";
  if (evidence.some((item) => item.severity === "warning")) return "medium";
  if (evidence.some((item) => item.kind === "no-text-artifacts")) return "unknown";
  return "low";
}

function emptyTextRiskArtifacts(): SourceMediaTextRiskSignals["artifacts"] {
  return {
    ocrPath: null,
    layoutReportPath: null,
    layoutPath: null,
    framePaths: [],
  };
}

function emptyTextRiskMetrics(): SourceMediaTextRiskSignals["metrics"] {
  return {
    ocrFrameCount: 0,
    ocrTextLineCount: 0,
    lowConfidenceLineCount: 0,
    bottomRegionLineCount: 0,
    layoutIssueCount: 0,
    fallbackFrameCount: 0,
  };
}

function layoutSeverity(value: unknown): SourceMediaTextRiskEvidenceSeverity {
  if (value === "error") return "error";
  if (value === "warning") return "warning";
  return "info";
}

function normalizeTextValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function skippedAudioSignals(
  input: SourceMediaSignalsRequest,
  probe: MediaProbeArtifact,
  diagnostic: string,
): SourceMediaAudioSignals {
  return {
    status: "skipped",
    hasAudio: probe.hasAudio,
    meanVolumeDb: null,
    maxVolumeDb: null,
    silenceThresholdDb: input.silenceNoiseDb,
    minSilenceDurationSeconds: input.silenceMinDurationSeconds,
    silenceSegments: [],
    totalSilenceSeconds: null,
    silentShare: null,
    diagnostic,
  };
}

function unavailableAudioSignals(input: SourceMediaSignalsRequest): SourceMediaAudioSignals {
  return {
    status: "unavailable",
    hasAudio: false,
    meanVolumeDb: null,
    maxVolumeDb: null,
    silenceThresholdDb: input.silenceNoiseDb,
    minSilenceDurationSeconds: input.silenceMinDurationSeconds,
    silenceSegments: [],
    totalSilenceSeconds: null,
    silentShare: null,
    diagnostic: "ffprobe found no audio stream",
  };
}

function parseSilenceSegments(stderr: string, durationSeconds: number | null): SourceMediaSilenceSegment[] {
  const segments: SourceMediaSilenceSegment[] = [];
  let openStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      openStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (endMatch) {
      const end = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      const start = openStart ?? end - duration;
      if (isFinitePositiveOrZero(start) && isFinitePositiveOrZero(end) && end >= start) {
        segments.push({
          startSeconds: roundSeconds(start),
          endSeconds: roundSeconds(end),
          durationSeconds: roundSeconds(duration),
        });
      }
      openStart = null;
    }
  }
  if (openStart !== null && durationSeconds !== null && durationSeconds >= openStart) {
    segments.push({
      startSeconds: roundSeconds(openStart),
      endSeconds: roundSeconds(durationSeconds),
      durationSeconds: roundSeconds(durationSeconds - openStart),
    });
  }
  return segments;
}

function parseDbValue(stderr: string, pattern: RegExp): number | null {
  const match = stderr.match(pattern);
  if (!match) return null;
  if (match[1] === "-inf") return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function classifyToolError(error: unknown): { status: "unavailable" | "failed"; diagnostic: string } {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown; stderr?: unknown };
    if (record.code === "ENOENT") {
      return { status: "unavailable", diagnostic: "required ffmpeg/ffprobe binary was not found" };
    }
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    const message = typeof record.message === "string" ? record.message : "";
    return { status: "failed", diagnostic: firstLine(stderr || message || "tool execution failed") };
  }
  return { status: "failed", diagnostic: "tool execution failed" };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? value;
}

async function defaultExtractShots(input: SourceMediaSignalsRequest) {
  return extractVideoShots({
    videoPath: input.videoPath,
    outputDir: input.outputDir,
    sceneThreshold: input.sceneThreshold,
    minShotDurationSeconds: input.minShotDurationSeconds,
    extractRepresentativeFrames: input.extractRepresentativeFrames,
  });
}

async function defaultExecFile(file: string, args: string[]): Promise<ExecFileResult> {
  const { stdout, stderr } = await execFileAsync(file, args);
  return { stdout, stderr };
}

function formatError(error: unknown): string {
  return classifyToolError(error).diagnostic;
}

function isFinitePositiveOrZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}
