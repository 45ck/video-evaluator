import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { VideoTechnicalReviewRequest } from "./schemas.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

interface PngImage {
  data: Buffer;
  width: number;
  height: number;
}

interface PngStatic {
  sync: { read: (buf: Buffer) => PngImage };
}

const { PNG } = require("pngjs") as { PNG: PngStatic };

export type VideoTechnicalIssueSeverity = "error" | "warning" | "info";

export type PreservedVideoTechnicalIssueCode =
  | "wrong-resolution"
  | "missing-audio"
  | "near-silent-audio"
  | "white-flash-or-white-frame"
  | "black-frame"
  | "white-edge-artifact"
  | "black-gutter-artifact"
  | "low-motion-run"
  | "caption-band-sparse";

export interface VideoTechnicalIssue {
  severity: VideoTechnicalIssueSeverity;
  code: PreservedVideoTechnicalIssueCode | `layout-${string}`;
  message: string;
  timeSeconds?: number;
  details?: Record<string, unknown>;
}

export interface VideoTechnicalProbe {
  durationSeconds: number;
  width: number;
  height: number;
  frameRate?: number;
  videoStreamCount: number;
  audioStreamCount: number;
  hasAudio: boolean;
}

export interface AudioTechnicalMetrics {
  meanVolumeDb?: number;
  maxVolumeDb?: number;
  analysisError?: string;
}

export interface FrameTechnicalMetrics {
  index: number;
  timestampSeconds: number;
  imagePath?: string;
  width: number;
  height: number;
  averageLuma: number;
  blackPixelRatio: number;
  whitePixelRatio: number;
  edgeBlackRatio: number;
  edgeWhiteRatio: number;
  contentBlackRatio: number;
  contentWhiteRatio: number;
  captionBandDetailRatio: number;
  motionScoreFromPrevious?: number;
}

export interface VideoTechnicalThresholds {
  expectedWidth?: number;
  expectedHeight?: number;
  nearSilentMeanVolumeDb: number;
  nearSilentMaxVolumeDb: number;
  blackFramePixelRatio: number;
  whiteFramePixelRatio: number;
  edgeArtifactRatio: number;
  maxContentExtremeRatioForEdgeArtifact: number;
  lowMotionFrameDifference: number;
  lowMotionMinRunSeconds: number;
  captionBandSparseRatio: number;
  captionBandSparseMinCoverage: number;
}

export interface ContactSheetMetadata {
  schemaVersion: "contact-sheet-metadata.v1";
  createdAt: string;
  videoPath: string;
  outputDir: string;
  sampledFrameCount: number;
  frames: Array<{
    index: number;
    timestampSeconds: number;
    imagePath?: string;
    metrics: Pick<
      FrameTechnicalMetrics,
      | "averageLuma"
      | "blackPixelRatio"
      | "whitePixelRatio"
      | "edgeBlackRatio"
      | "edgeWhiteRatio"
      | "captionBandDetailRatio"
      | "motionScoreFromPrevious"
    >;
  }>;
}

export interface VideoTechnicalReport {
  schemaVersion: "video-technical-report.v1";
  createdAt: string;
  videoPath: string;
  outputDir: string;
  contactSheetMetadataPath?: string;
  layoutReportPath?: string;
  probe: VideoTechnicalProbe;
  audio: AudioTechnicalMetrics;
  sampledFrameCount: number;
  issues: VideoTechnicalIssue[];
  metrics: {
    maxBlackPixelRatio: number;
    maxWhitePixelRatio: number;
    maxEdgeBlackRatio: number;
    maxEdgeWhiteRatio: number;
    longestLowMotionRunSeconds: number;
    captionBandSparseCoverage: number;
  };
  thresholds: VideoTechnicalThresholds;
}

export interface BuildVideoTechnicalReportInput {
  videoPath: string;
  outputDir: string;
  probe: VideoTechnicalProbe;
  audio?: AudioTechnicalMetrics;
  frames?: FrameTechnicalMetrics[];
  thresholds: VideoTechnicalThresholds;
  expectAudio: boolean;
  expectCaptions: boolean;
  layoutIssues?: VideoTechnicalIssue[];
  contactSheetMetadataPath?: string;
  layoutReportPath?: string;
}

interface LowMotionRun {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  frameCount: number;
}

export function defaultVideoTechnicalOutputDir(videoPath: string): string {
  return join(dirname(resolve(videoPath)), "video-evaluator-technical-review");
}

export function buildVideoTechnicalThresholds(
  input: Pick<
    VideoTechnicalReviewRequest,
    | "expectedWidth"
    | "expectedHeight"
    | "nearSilentMeanVolumeDb"
    | "nearSilentMaxVolumeDb"
    | "blackFramePixelRatio"
    | "whiteFramePixelRatio"
    | "edgeArtifactRatio"
    | "maxContentExtremeRatioForEdgeArtifact"
    | "lowMotionFrameDifference"
    | "lowMotionMinRunSeconds"
    | "captionBandSparseRatio"
    | "captionBandSparseMinCoverage"
  >,
): VideoTechnicalThresholds {
  return {
    expectedWidth: input.expectedWidth,
    expectedHeight: input.expectedHeight,
    nearSilentMeanVolumeDb: input.nearSilentMeanVolumeDb,
    nearSilentMaxVolumeDb: input.nearSilentMaxVolumeDb,
    blackFramePixelRatio: input.blackFramePixelRatio,
    whiteFramePixelRatio: input.whiteFramePixelRatio,
    edgeArtifactRatio: input.edgeArtifactRatio,
    maxContentExtremeRatioForEdgeArtifact:
      input.maxContentExtremeRatioForEdgeArtifact,
    lowMotionFrameDifference: input.lowMotionFrameDifference,
    lowMotionMinRunSeconds: input.lowMotionMinRunSeconds,
    captionBandSparseRatio: input.captionBandSparseRatio,
    captionBandSparseMinCoverage: input.captionBandSparseMinCoverage,
  };
}

export function analyzePngFrame(
  buffer: Buffer,
  input: {
    index: number;
    timestampSeconds: number;
    imagePath?: string;
    previous?: FrameTechnicalMetrics;
    previousBuffer?: Buffer;
  },
): FrameTechnicalMetrics {
  const png = PNG.sync.read(buffer);
  const previousPng = input.previousBuffer
    ? PNG.sync.read(input.previousBuffer)
    : undefined;
  const width = png.width;
  const height = png.height;
  const edgeInsetX = Math.max(1, Math.floor(width * 0.035));
  const edgeInsetY = Math.max(1, Math.floor(height * 0.035));
  const captionY0 = Math.floor(height * 0.68);
  const captionY1 = Math.floor(height * 0.9);
  const captionBandLumas: number[] = [];

  let totalLuma = 0;
  let blackPixels = 0;
  let whitePixels = 0;
  let edgePixels = 0;
  let edgeBlackPixels = 0;
  let edgeWhitePixels = 0;
  let contentPixels = 0;
  let contentBlackPixels = 0;
  let contentWhitePixels = 0;
  let motionTotal = 0;
  let motionCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) << 2;
      const luma = pixelLuma(png.data, offset);
      totalLuma += luma;
      if (luma <= 0.05) blackPixels += 1;
      if (luma >= 0.95) whitePixels += 1;

      const isEdge =
        x < edgeInsetX ||
        x >= width - edgeInsetX ||
        y < edgeInsetY ||
        y >= height - edgeInsetY;
      if (isEdge) {
        edgePixels += 1;
        if (luma <= 0.08) edgeBlackPixels += 1;
        if (luma >= 0.92) edgeWhitePixels += 1;
      } else {
        contentPixels += 1;
        if (luma <= 0.08) contentBlackPixels += 1;
        if (luma >= 0.92) contentWhitePixels += 1;
      }

      if (y >= captionY0 && y <= captionY1) {
        captionBandLumas.push(luma);
      }

      if (
        previousPng &&
        previousPng.width === width &&
        previousPng.height === height
      ) {
        motionTotal += Math.abs(luma - pixelLuma(previousPng.data, offset));
        motionCount += 1;
      }
    }
  }

  const pixelCount = width * height;
  return {
    index: input.index,
    timestampSeconds: input.timestampSeconds,
    imagePath: input.imagePath,
    width,
    height,
    averageLuma: round(totalLuma / pixelCount),
    blackPixelRatio: round(blackPixels / pixelCount),
    whitePixelRatio: round(whitePixels / pixelCount),
    edgeBlackRatio: round(edgeBlackPixels / Math.max(1, edgePixels)),
    edgeWhiteRatio: round(edgeWhitePixels / Math.max(1, edgePixels)),
    contentBlackRatio: round(contentBlackPixels / Math.max(1, contentPixels)),
    contentWhiteRatio: round(contentWhitePixels / Math.max(1, contentPixels)),
    captionBandDetailRatio: round(captionBandDetailRatio(captionBandLumas)),
    motionScoreFromPrevious:
      motionCount > 0 ? round(motionTotal / motionCount) : undefined,
  };
}

export function buildVideoTechnicalReport(
  input: BuildVideoTechnicalReportInput,
): VideoTechnicalReport {
  const frames = input.frames ?? [];
  const thresholds = input.thresholds;
  const issues: VideoTechnicalIssue[] = [];

  if (
    thresholds.expectedWidth !== undefined &&
    thresholds.expectedHeight !== undefined &&
    (input.probe.width !== thresholds.expectedWidth ||
      input.probe.height !== thresholds.expectedHeight)
  ) {
    issues.push(
      issue(
        "error",
        "wrong-resolution",
        `Video resolution is ${input.probe.width}x${input.probe.height}, expected ${thresholds.expectedWidth}x${thresholds.expectedHeight}.`,
        undefined,
        {
          actualWidth: input.probe.width,
          actualHeight: input.probe.height,
          expectedWidth: thresholds.expectedWidth,
          expectedHeight: thresholds.expectedHeight,
        },
      ),
    );
  }

  if (input.expectAudio && !input.probe.hasAudio) {
    issues.push(
      issue("error", "missing-audio", "No audio stream was found.", undefined, {
        audioStreamCount: input.probe.audioStreamCount,
      }),
    );
  }

  if (input.expectAudio && input.probe.hasAudio && input.audio) {
    const meanNearSilent =
      input.audio.meanVolumeDb !== undefined &&
      input.audio.meanVolumeDb <= thresholds.nearSilentMeanVolumeDb;
    const maxNearSilent =
      input.audio.maxVolumeDb !== undefined &&
      input.audio.maxVolumeDb <= thresholds.nearSilentMaxVolumeDb;
    if (meanNearSilent || maxNearSilent) {
      issues.push(
        issue(
          "warning",
          "near-silent-audio",
          "Audio stream volume is near silent.",
          undefined,
          {
            meanVolumeDb: input.audio.meanVolumeDb,
            maxVolumeDb: input.audio.maxVolumeDb,
            nearSilentMeanVolumeDb: thresholds.nearSilentMeanVolumeDb,
            nearSilentMaxVolumeDb: thresholds.nearSilentMaxVolumeDb,
          },
        ),
      );
    }
  }

  for (const frame of frames) {
    if (frame.whitePixelRatio >= thresholds.whiteFramePixelRatio) {
      issues.push(
        issue(
          "error",
          "white-flash-or-white-frame",
          "Sampled frame is mostly white.",
          frame.timestampSeconds,
          {
            frameIndex: frame.index,
            whitePixelRatio: frame.whitePixelRatio,
          },
        ),
      );
    }

    if (frame.blackPixelRatio >= thresholds.blackFramePixelRatio) {
      issues.push(
        issue("error", "black-frame", "Sampled frame is mostly black.", frame.timestampSeconds, {
          frameIndex: frame.index,
          blackPixelRatio: frame.blackPixelRatio,
        }),
      );
    }

    if (
      frame.edgeWhiteRatio >= thresholds.edgeArtifactRatio &&
      frame.contentWhiteRatio <= thresholds.maxContentExtremeRatioForEdgeArtifact
    ) {
      issues.push(
        issue(
          "warning",
          "white-edge-artifact",
          "Sampled frame has a bright edge artifact.",
          frame.timestampSeconds,
          {
            frameIndex: frame.index,
            edgeWhiteRatio: frame.edgeWhiteRatio,
            contentWhiteRatio: frame.contentWhiteRatio,
          },
        ),
      );
    }

    if (
      frame.edgeBlackRatio >= thresholds.edgeArtifactRatio &&
      frame.contentBlackRatio <= thresholds.maxContentExtremeRatioForEdgeArtifact
    ) {
      issues.push(
        issue(
          "warning",
          "black-gutter-artifact",
          "Sampled frame has black edge gutters.",
          frame.timestampSeconds,
          {
            frameIndex: frame.index,
            edgeBlackRatio: frame.edgeBlackRatio,
            contentBlackRatio: frame.contentBlackRatio,
          },
        ),
      );
    }
  }

  const lowMotionRuns = findLowMotionRuns(
    frames,
    thresholds.lowMotionFrameDifference,
    thresholds.lowMotionMinRunSeconds,
  );
  for (const run of lowMotionRuns) {
    issues.push(
      issue(
        "warning",
        "low-motion-run",
        "Sampled frames indicate a low-motion run.",
        run.startSeconds,
        {
          startSeconds: run.startSeconds,
          endSeconds: run.endSeconds,
          durationSeconds: run.durationSeconds,
          frameCount: run.frameCount,
        },
      ),
    );
  }

  if (input.expectCaptions && frames.length > 0) {
    const sparseFrames = frames.filter(
      (frame) =>
        frame.captionBandDetailRatio <= thresholds.captionBandSparseRatio,
    );
    const sparseCoverage = sparseFrames.length / frames.length;
    if (sparseCoverage >= thresholds.captionBandSparseMinCoverage) {
      issues.push(
        issue(
          "warning",
          "caption-band-sparse",
          "Caption band has little visible detail across sampled frames.",
          undefined,
          {
            sparseFrameCount: sparseFrames.length,
            sampledFrameCount: frames.length,
            sparseCoverage: round(sparseCoverage),
            captionBandSparseRatio: thresholds.captionBandSparseRatio,
          },
        ),
      );
    }
  }

  issues.push(...(input.layoutIssues ?? []).filter(isLayoutIssue));

  const report: VideoTechnicalReport = {
    schemaVersion: "video-technical-report.v1",
    createdAt: new Date().toISOString(),
    videoPath: resolve(input.videoPath),
    outputDir: resolve(input.outputDir),
    contactSheetMetadataPath: input.contactSheetMetadataPath,
    layoutReportPath: input.layoutReportPath,
    probe: input.probe,
    audio: input.audio ?? {},
    sampledFrameCount: frames.length,
    issues: sortIssues(dedupeIssues(issues)),
    metrics: {
      maxBlackPixelRatio: maxFrameMetric(frames, "blackPixelRatio"),
      maxWhitePixelRatio: maxFrameMetric(frames, "whitePixelRatio"),
      maxEdgeBlackRatio: maxFrameMetric(frames, "edgeBlackRatio"),
      maxEdgeWhiteRatio: maxFrameMetric(frames, "edgeWhiteRatio"),
      longestLowMotionRunSeconds: round(
        Math.max(0, ...lowMotionRuns.map((run) => run.durationSeconds)),
      ),
      captionBandSparseCoverage: captionBandSparseCoverage(
        frames,
        thresholds.captionBandSparseRatio,
      ),
    },
    thresholds,
  };
  return report;
}

export async function reviewVideoTechnical(
  input: VideoTechnicalReviewRequest,
): Promise<{
  reportPath: string;
  report: VideoTechnicalReport;
  contactSheetMetadataPath?: string;
  contactSheetMetadata?: ContactSheetMetadata;
}> {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? defaultVideoTechnicalOutputDir(videoPath));
  const frameDir = join(outputDir, "contact-sheet-frames");
  await mkdir(frameDir, { recursive: true });

  const probe = await probeVideo(videoPath);
  const frames = await extractAndAnalyzeFrames({
    videoPath,
    outputDir: frameDir,
    durationSeconds: probe.durationSeconds,
    sampleCount: input.frameSampleCount,
  });
  const audio = probe.hasAudio ? await measureAudio(videoPath) : {};
  const thresholds = buildVideoTechnicalThresholds(input);
  const layoutIssues = input.layoutReportPath
    ? await readLayoutPassThroughIssues(input.layoutReportPath)
    : [];

  const contactSheetMetadata = buildContactSheetMetadata({
    videoPath,
    outputDir,
    frames,
  });
  const contactSheetMetadataPath = join(outputDir, "contact-sheet.metadata.json");
  await writeFile(
    contactSheetMetadataPath,
    `${JSON.stringify(contactSheetMetadata, null, 2)}\n`,
    "utf8",
  );

  const report = buildVideoTechnicalReport({
    videoPath,
    outputDir,
    probe,
    audio,
    frames,
    thresholds,
    expectAudio: input.expectAudio,
    expectCaptions: input.expectCaptions,
    layoutIssues,
    contactSheetMetadataPath,
    layoutReportPath: input.layoutReportPath
      ? resolve(input.layoutReportPath)
      : undefined,
  });
  const reportPath = join(outputDir, "video-technical.report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, report, contactSheetMetadataPath, contactSheetMetadata };
}

function buildContactSheetMetadata(input: {
  videoPath: string;
  outputDir: string;
  frames: FrameTechnicalMetrics[];
}): ContactSheetMetadata {
  return {
    schemaVersion: "contact-sheet-metadata.v1",
    createdAt: new Date().toISOString(),
    videoPath: input.videoPath,
    outputDir: input.outputDir,
    sampledFrameCount: input.frames.length,
    frames: input.frames.map((frame) => ({
      index: frame.index,
      timestampSeconds: frame.timestampSeconds,
      imagePath: frame.imagePath,
      metrics: {
        averageLuma: frame.averageLuma,
        blackPixelRatio: frame.blackPixelRatio,
        whitePixelRatio: frame.whitePixelRatio,
        edgeBlackRatio: frame.edgeBlackRatio,
        edgeWhiteRatio: frame.edgeWhiteRatio,
        captionBandDetailRatio: frame.captionBandDetailRatio,
        motionScoreFromPrevious: frame.motionScoreFromPrevious,
      },
    })),
  };
}

async function probeVideo(videoPath: string): Promise<VideoTechnicalProbe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };
  const streams = parsed.streams ?? [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const primaryVideo = videoStreams[0];
  if (!primaryVideo?.width || !primaryVideo.height) {
    throw new Error(`Could not determine video stream dimensions for ${videoPath}`);
  }
  const durationSeconds = Number(parsed.format?.duration ?? "0");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Could not determine duration for ${videoPath}`);
  }
  return {
    durationSeconds: round(durationSeconds),
    width: primaryVideo.width,
    height: primaryVideo.height,
    frameRate: parseFrameRate(primaryVideo.r_frame_rate),
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    hasAudio: audioStreams.length > 0,
  };
}

async function extractAndAnalyzeFrames(input: {
  videoPath: string;
  outputDir: string;
  durationSeconds: number;
  sampleCount: number;
}): Promise<FrameTechnicalMetrics[]> {
  const timestamps = buildSampleTimestamps(input.durationSeconds, input.sampleCount);
  const frames: FrameTechnicalMetrics[] = [];
  let previousFrame: FrameTechnicalMetrics | undefined;
  let previousBuffer: Buffer | undefined;

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSeconds = timestamps[index]!;
    const imagePath = join(input.outputDir, `frame-${String(index + 1).padStart(3, "0")}.png`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(timestampSeconds),
      "-i",
      input.videoPath,
      "-frames:v",
      "1",
      imagePath,
    ]);
    const buffer = await readFile(imagePath);
    const metrics = analyzePngFrame(buffer, {
      index: index + 1,
      timestampSeconds,
      imagePath,
      previous: previousFrame,
      previousBuffer,
    });
    frames.push(metrics);
    previousFrame = metrics;
    previousBuffer = buffer;
  }

  return frames;
}

async function measureAudio(videoPath: string): Promise<AudioTechnicalMetrics> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-i",
      videoPath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);
    return parseVolumeDetect(stderr);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    const parsed = parseVolumeDetect(stderr);
    if (
      parsed.meanVolumeDb !== undefined ||
      parsed.maxVolumeDb !== undefined
    ) {
      return parsed;
    }
    return {
      analysisError:
        error instanceof Error ? error.message : "Audio volume analysis failed.",
    };
  }
}

function parseVolumeDetect(stderr: string): AudioTechnicalMetrics {
  const mean = stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
  const max = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return {
    meanVolumeDb: mean ? Number(mean[1]) : undefined,
    maxVolumeDb: max ? Number(max[1]) : undefined,
  };
}

async function readLayoutPassThroughIssues(
  layoutReportPath: string,
): Promise<VideoTechnicalIssue[]> {
  const raw = await readFile(resolve(layoutReportPath), "utf8");
  const parsed = JSON.parse(raw) as {
    issues?: Array<{
      severity?: string;
      code?: string;
      message?: string;
      timeSeconds?: number;
      details?: Record<string, unknown>;
    }>;
  };
  return (parsed.issues ?? [])
    .filter((item) => typeof item.code === "string" && item.code.startsWith("layout-"))
    .map((item) =>
      issue(
        normalizeSeverity(item.severity),
        item.code as `layout-${string}`,
        item.message ?? "Layout issue passed through from layout report.",
        item.timeSeconds,
        item.details,
      ),
    );
}

function buildSampleTimestamps(durationSeconds: number, sampleCount: number): number[] {
  return Array.from({ length: sampleCount }, (_, index) =>
    round((durationSeconds * (index + 1)) / (sampleCount + 1)),
  );
}

function parseFrameRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return round(numerator / denominator);
}

function findLowMotionRuns(
  frames: FrameTechnicalMetrics[],
  lowMotionFrameDifference: number,
  lowMotionMinRunSeconds: number,
): LowMotionRun[] {
  const runs: LowMotionRun[] = [];
  let runStart: FrameTechnicalMetrics | undefined;
  let runEnd: FrameTechnicalMetrics | undefined;
  let frameCount = 0;

  for (const frame of frames) {
    const isLowMotion =
      frame.motionScoreFromPrevious !== undefined &&
      frame.motionScoreFromPrevious <= lowMotionFrameDifference;
    if (isLowMotion) {
      runStart ??= frame;
      runEnd = frame;
      frameCount += 1;
      continue;
    }
    if (runStart && runEnd) {
      pushLowMotionRun(runs, runStart, runEnd, frameCount, lowMotionMinRunSeconds);
    }
    runStart = undefined;
    runEnd = undefined;
    frameCount = 0;
  }
  if (runStart && runEnd) {
    pushLowMotionRun(runs, runStart, runEnd, frameCount, lowMotionMinRunSeconds);
  }
  return runs;
}

function pushLowMotionRun(
  runs: LowMotionRun[],
  start: FrameTechnicalMetrics,
  end: FrameTechnicalMetrics,
  frameCount: number,
  minDurationSeconds: number,
): void {
  const durationSeconds = round(end.timestampSeconds - start.timestampSeconds);
  if (durationSeconds < minDurationSeconds) return;
  runs.push({
    startSeconds: start.timestampSeconds,
    endSeconds: end.timestampSeconds,
    durationSeconds,
    frameCount,
  });
}

function captionBandDetailRatio(lumas: number[]): number {
  if (lumas.length === 0) return 0;
  const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
  const highContrastPixels = lumas.filter(
    (value) => Math.abs(value - mean) >= 0.18,
  ).length;
  return highContrastPixels / lumas.length;
}

function captionBandSparseCoverage(
  frames: FrameTechnicalMetrics[],
  captionBandSparseRatio: number,
): number {
  if (frames.length === 0) return 0;
  return round(
    frames.filter(
      (frame) => frame.captionBandDetailRatio <= captionBandSparseRatio,
    ).length / frames.length,
  );
}

function pixelLuma(data: Buffer, offset: number): number {
  return (0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!) / 255;
}

function maxFrameMetric(
  frames: FrameTechnicalMetrics[],
  key: keyof Pick<
    FrameTechnicalMetrics,
    "blackPixelRatio" | "whitePixelRatio" | "edgeBlackRatio" | "edgeWhiteRatio"
  >,
): number {
  return round(Math.max(0, ...frames.map((frame) => frame[key])));
}

function isLayoutIssue(issue: VideoTechnicalIssue): issue is VideoTechnicalIssue & {
  code: `layout-${string}`;
} {
  return issue.code.startsWith("layout-");
}

function issue(
  severity: VideoTechnicalIssueSeverity,
  code: VideoTechnicalIssue["code"],
  message: string,
  timeSeconds?: number,
  details?: Record<string, unknown>,
): VideoTechnicalIssue {
  return { severity, code, message, timeSeconds, details };
}

function dedupeIssues(issues: VideoTechnicalIssue[]): VideoTechnicalIssue[] {
  const seen = new Set<string>();
  const result: VideoTechnicalIssue[] = [];
  for (const item of issues) {
    const key = `${item.code}:${item.timeSeconds ?? ""}:${JSON.stringify(item.details ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sortIssues(issues: VideoTechnicalIssue[]): VideoTechnicalIssue[] {
  const rank: Record<VideoTechnicalIssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...issues].sort((left, right) => {
    const severityDelta = rank[left.severity] - rank[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return (left.timeSeconds ?? -1) - (right.timeSeconds ?? -1);
  });
}

function normalizeSeverity(value: string | undefined): VideoTechnicalIssueSeverity {
  if (value === "error" || value === "warning" || value === "info") return value;
  return "warning";
}

function round(value: number): number {
  return Number(value.toFixed(5));
}
