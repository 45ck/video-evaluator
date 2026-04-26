import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import type { StoryboardExtractRequest } from "./schemas.js";
import { diffPngFiles, diffPngRegionFiles } from "./image-diff.js";

const execFileAsync = promisify(execFile);

export interface StoryboardFrame {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  samplingReason?: "uniform" | "change-peak" | "coverage-fill";
  nearestChangeDistanceSeconds?: number;
  samplingSignal?: "scene-change" | "same-screen-change";
  samplingScore?: number;
}

export interface StoryboardManifest {
  schemaVersion: 1;
  createdAt: string;
  videoPath: string;
  outputDir: string;
  frameCount: number;
  durationSeconds: number;
  format: "jpg" | "png";
  samplingMode: "uniform" | "hybrid";
  changeThreshold?: number;
  detectedChangeCount?: number;
  candidateDiagnostics?: {
    sourceCounts: {
      "scene-change": number;
      "same-screen-change": number;
    };
    topCandidates: Array<{
      timestampSeconds: number;
      source: "scene-change" | "same-screen-change";
      score: number;
      diagnostics?: {
        overallDiffPercent?: number;
        topDiffPercent?: number;
        middleDiffPercent?: number;
        bottomDiffPercent?: number;
      };
    }>;
  };
  frames: StoryboardFrame[];
}

interface PlannedStoryboardFrame {
  timestampSeconds: number;
  samplingReason: NonNullable<StoryboardFrame["samplingReason"]>;
  samplingSignal?: StoryboardFrame["samplingSignal"];
  samplingScore?: number;
}

interface ChangeCandidate {
  timestampSeconds: number;
  source: "scene-change" | "same-screen-change";
  score: number;
  diagnostics?: {
    overallDiffPercent?: number;
    topDiffPercent?: number;
    middleDiffPercent?: number;
    bottomDiffPercent?: number;
  };
}

async function probeDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(parsed.format?.duration ?? "0");
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine duration for ${videoPath}`);
  }
  return duration;
}

function defaultOutputDir(videoPath: string): string {
  const root = dirname(resolve(videoPath));
  return join(root, "video-evaluator-storyboard");
}

export function buildUniformTimestamps(durationSeconds: number, frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_, index) =>
    Number(((durationSeconds * (index + 1)) / (frameCount + 1)).toFixed(3)),
  );
}

function annotateUniformFrames(timestamps: number[]): PlannedStoryboardFrame[] {
  return timestamps.map((timestampSeconds) => ({
    timestampSeconds,
    samplingReason: "uniform",
  }));
}

function pickEvenlySpacedValues(values: number[], count: number): number[] {
  if (count <= 0 || values.length === 0) return [];
  if (count >= values.length) return [...values];
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index * (values.length - 1)) / Math.max(1, count - 1));
    return values[position];
  });
}

function pickEvenlySpacedEntries<T>(values: T[], count: number): T[] {
  if (count <= 0 || values.length === 0) return [];
  if (count >= values.length) return [...values];
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index * (values.length - 1)) / Math.max(1, count - 1));
    return values[position];
  });
}

function dedupeSortedTimestamps(values: number[]): number[] {
  return values.filter((value, index) => index === 0 || Math.abs(value - values[index - 1]) > 0.001);
}

function canAddTimestamp(value: number, chosen: number[], minSpacingSeconds: number): boolean {
  return chosen.every((existing) => Math.abs(existing - value) >= minSpacingSeconds);
}

function nearestDistanceSeconds(value: number, candidates: number[]): number | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - value);
    if (best === undefined || distance < best) return distance;
    return best;
  }, undefined as number | undefined);
}

function normalizeCandidates(
  durationSeconds: number,
  candidates: Array<number | ChangeCandidate>,
): ChangeCandidate[] {
  const mapped = candidates
    .map((candidate) =>
      typeof candidate === "number"
        ? { timestampSeconds: candidate, source: "scene-change" as const, score: 1 }
        : candidate,
    )
    .filter((candidate) => Number.isFinite(candidate.timestampSeconds))
    .filter((candidate) => candidate.timestampSeconds > 0 && candidate.timestampSeconds < durationSeconds)
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds);

  const merged: ChangeCandidate[] = [];
  for (const candidate of mapped) {
    const previous = merged[merged.length - 1];
    if (!previous || Math.abs(previous.timestampSeconds - candidate.timestampSeconds) > 0.35) {
      merged.push({ ...candidate });
      continue;
    }

    const preferCurrent =
      candidate.score > previous.score ||
      (candidate.score === previous.score &&
        candidate.source === "same-screen-change" &&
        previous.source !== "same-screen-change");

    if (preferCurrent) {
      merged[merged.length - 1] = { ...candidate };
    }
  }

  return merged;
}

export function inferSameScreenProbeScore(input: {
  overallDiffPercent: number;
  topDiffPercent: number;
  middleDiffPercent: number;
  bottomDiffPercent: number;
}): number {
  const lowerRegionDelta = Math.max(input.middleDiffPercent, input.bottomDiffPercent);
  const topStable =
    input.topDiffPercent <= 0.045 ||
    (lowerRegionDelta >= 0.08 && input.topDiffPercent <= lowerRegionDelta * 0.6);
  const localChangeStrength = lowerRegionDelta - input.topDiffPercent;
  const notHardCut = input.overallDiffPercent <= 0.18;
  if (!topStable || !notHardCut || localChangeStrength <= 0.015) {
    return 0;
  }
  return Number(
    Math.max(0, Math.min(1, localChangeStrength * 8 + lowerRegionDelta * 1.5 - input.overallDiffPercent)).toFixed(4),
  );
}

function selectCandidatePeaks(
  candidates: ChangeCandidate[],
  maxCount: number,
  minSpacingSeconds: number,
): ChangeCandidate[] {
  const chosen: ChangeCandidate[] = [];
  const sorted = [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.timestampSeconds - right.timestampSeconds;
  });
  for (const candidate of sorted) {
    if (chosen.length >= maxCount) break;
    if (canAddTimestamp(candidate.timestampSeconds, chosen.map((entry) => entry.timestampSeconds), minSpacingSeconds)) {
      chosen.push(candidate);
    }
  }
  return chosen.sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

function buildHybridFramePlan(
  durationSeconds: number,
  frameCount: number,
  candidateInput: Array<number | ChangeCandidate>,
): PlannedStoryboardFrame[] {
  const uniform = buildUniformTimestamps(durationSeconds, frameCount);
  const minSpacingSeconds = Math.max(durationSeconds / Math.max(frameCount * 6, 1), 0.6);
  const normalizedCandidates = normalizeCandidates(durationSeconds, candidateInput);

  if (normalizedCandidates.length === 0) {
    return annotateUniformFrames(uniform);
  }

  const candidateBudget = Math.min(
    normalizedCandidates.length,
    Math.max(1, Math.ceil(frameCount / 2)),
  );
  const prioritizedCandidates = selectCandidatePeaks(normalizedCandidates, candidateBudget, minSpacingSeconds);
  const spreadCandidates = pickEvenlySpacedEntries(normalizedCandidates, candidateBudget);
  const fallbackGrid = buildUniformTimestamps(durationSeconds, Math.max(frameCount * 3, frameCount));
  const chosen: PlannedStoryboardFrame[] = [];
  const chosenTimestamps: number[] = [];
  const addTimestamps = (
    values: number[],
    samplingReason: PlannedStoryboardFrame["samplingReason"],
  ) => {
    for (const value of values) {
      if (chosen.length >= frameCount) return;
      if (canAddTimestamp(value, chosenTimestamps, minSpacingSeconds)) {
        chosen.push({
          timestampSeconds: value,
          samplingReason,
          samplingSignal: undefined,
          samplingScore: undefined,
        });
        chosenTimestamps.push(value);
      }
    }
  };

  for (const candidate of prioritizedCandidates) {
    if (chosen.length >= frameCount) break;
    if (canAddTimestamp(candidate.timestampSeconds, chosenTimestamps, minSpacingSeconds)) {
      chosen.push({
        timestampSeconds: candidate.timestampSeconds,
        samplingReason: "change-peak",
        samplingSignal: candidate.source,
        samplingScore: candidate.score,
      });
      chosenTimestamps.push(candidate.timestampSeconds);
    }
  }
  for (const candidate of spreadCandidates) {
    if (chosen.length >= frameCount) break;
    if (canAddTimestamp(candidate.timestampSeconds, chosenTimestamps, minSpacingSeconds)) {
      chosen.push({
        timestampSeconds: candidate.timestampSeconds,
        samplingReason: "change-peak",
        samplingSignal: candidate.source,
        samplingScore: candidate.score,
      });
      chosenTimestamps.push(candidate.timestampSeconds);
    }
  }
  addTimestamps(uniform, "uniform");
  addTimestamps(fallbackGrid, "coverage-fill");

  return chosen
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds)
    .slice(0, frameCount);
}

export function buildHybridTimestamps(
  durationSeconds: number,
  frameCount: number,
  candidateInput: Array<number | ChangeCandidate>,
): number[] {
  return buildHybridFramePlan(durationSeconds, frameCount, candidateInput).map(
    (frame) => frame.timestampSeconds,
  );
}

async function detectSceneChangeCandidates(videoPath: string, threshold: number): Promise<ChangeCandidate[]> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-i",
      videoPath,
      "-filter:v",
      `select='gt(scene,${threshold})',showinfo`,
      "-an",
      "-f",
      "null",
      "-",
    ]);
    return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => ({
      timestampSeconds: Number(match[1]),
      source: "scene-change" as const,
      score: 0.7,
    }));
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    const matches = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => ({
      timestampSeconds: Number(match[1]),
      source: "scene-change" as const,
      score: 0.7,
    }));
    if (matches.length > 0) return matches;
    return [];
  }
}

async function extractProbeFrames(
  videoPath: string,
  durationSeconds: number,
  frameCount: number,
  tempDir: string,
): Promise<Array<{ timestampSeconds: number; imagePath: string }>> {
  const probeFrameCount = Math.min(Math.max(frameCount * 3, 12), 30);
  const timestamps = buildUniformTimestamps(durationSeconds, probeFrameCount);
  const frames: Array<{ timestampSeconds: number; imagePath: string }> = [];

  for (const [index, timestampSeconds] of timestamps.entries()) {
    const imagePath = join(tempDir, `probe-${String(index + 1).padStart(2, "0")}.png`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(timestampSeconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-1,format=gray",
      imagePath,
    ]);
    frames.push({ timestampSeconds, imagePath });
  }

  return frames;
}

async function detectSameScreenChangeCandidates(
  videoPath: string,
  durationSeconds: number,
  frameCount: number,
): Promise<ChangeCandidate[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "video-evaluator-probe-"));
  try {
    const probeFrames = await extractProbeFrames(videoPath, durationSeconds, frameCount, tempDir);
    const candidates: ChangeCandidate[] = [];

    for (let index = 1; index < probeFrames.length; index += 1) {
      const previous = probeFrames[index - 1];
      const current = probeFrames[index];
      const [overall, top, middle, bottom] = await Promise.all([
        diffPngFiles(previous.imagePath, current.imagePath),
        diffPngRegionFiles(previous.imagePath, current.imagePath, { y0: 0, y1: 0.25 }),
        diffPngRegionFiles(previous.imagePath, current.imagePath, { y0: 0.25, y1: 0.7 }),
        diffPngRegionFiles(previous.imagePath, current.imagePath, { y0: 0.7, y1: 1 }),
      ]);
      const score = inferSameScreenProbeScore({
        overallDiffPercent: overall.mismatchPercent,
        topDiffPercent: top.mismatchPercent,
        middleDiffPercent: middle.mismatchPercent,
        bottomDiffPercent: bottom.mismatchPercent,
      });
      if (score > 0) {
        candidates.push({
          timestampSeconds: current.timestampSeconds,
          source: "same-screen-change",
          score,
          diagnostics: {
            overallDiffPercent: overall.mismatchPercent,
            topDiffPercent: top.mismatchPercent,
            middleDiffPercent: middle.mismatchPercent,
            bottomDiffPercent: bottom.mismatchPercent,
          },
        });
      }
    }

    return candidates;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractStoryboard(input: StoryboardExtractRequest) {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? defaultOutputDir(videoPath));
  await mkdir(outputDir, { recursive: true });

  const durationSeconds = await probeDuration(videoPath);
  const detectedChangeCandidates =
    input.samplingMode === "hybrid"
      ? [
          ...(await detectSceneChangeCandidates(videoPath, input.changeThreshold)),
          ...(await detectSameScreenChangeCandidates(videoPath, durationSeconds, input.frameCount)),
        ]
      : [];
  const candidateDiagnostics =
    input.samplingMode === "hybrid"
      ? {
          sourceCounts: {
            "scene-change": detectedChangeCandidates.filter((candidate) => candidate.source === "scene-change").length,
            "same-screen-change": detectedChangeCandidates.filter((candidate) => candidate.source === "same-screen-change")
              .length,
          },
          topCandidates: [...detectedChangeCandidates]
            .sort((left, right) => right.score - left.score || left.timestampSeconds - right.timestampSeconds)
            .slice(0, 12)
            .map((candidate) => ({
              timestampSeconds: candidate.timestampSeconds,
              source: candidate.source,
              score: candidate.score,
              diagnostics: candidate.diagnostics,
            })),
        }
      : undefined;
  const framePlan =
    input.samplingMode === "hybrid"
      ? buildHybridFramePlan(durationSeconds, input.frameCount, detectedChangeCandidates)
      : annotateUniformFrames(buildUniformTimestamps(durationSeconds, input.frameCount));
  const frames: StoryboardFrame[] = [];

  for (const [index, plannedFrame] of framePlan.entries()) {
    const timestampSeconds = plannedFrame.timestampSeconds;
    const imagePath = join(outputDir, `frame-${String(index + 1).padStart(2, "0")}.${input.format}`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(timestampSeconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      imagePath,
    ]);
    frames.push({
      index: index + 1,
      timestampSeconds,
      imagePath,
      samplingReason: plannedFrame.samplingReason,
      samplingSignal: plannedFrame.samplingSignal,
      samplingScore: plannedFrame.samplingScore,
      nearestChangeDistanceSeconds:
        input.samplingMode === "hybrid"
          ? nearestDistanceSeconds(
              timestampSeconds,
              detectedChangeCandidates.map((candidate) => candidate.timestampSeconds),
            )
          : undefined,
    });
  }

  const manifest: StoryboardManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    videoPath,
    outputDir,
    frameCount: input.frameCount,
    durationSeconds,
    format: input.format,
    samplingMode: input.samplingMode,
    changeThreshold: input.samplingMode === "hybrid" ? input.changeThreshold : undefined,
    detectedChangeCount: input.samplingMode === "hybrid" ? detectedChangeCandidates.length : undefined,
    candidateDiagnostics,
    frames,
  };

  const manifestPath = join(outputDir, "storyboard.manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    manifestPath,
    manifest,
  };
}
