import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

export interface SourceMediaTextRiskPlaceholder {
  status: "placeholder";
  riskLevel: "unknown";
  evidence: [];
  diagnostic: string;
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
  textRisk: SourceMediaTextRiskPlaceholder;
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
    textRisk: {
      status: "placeholder",
      riskLevel: "unknown",
      evidence: [],
      diagnostic:
        "Text risk extraction is not implemented in this first slice; run OCR/layout tools for evidence.",
    },
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
