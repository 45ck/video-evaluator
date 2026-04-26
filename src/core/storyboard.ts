import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StoryboardExtractRequest } from "./schemas.js";

const execFileAsync = promisify(execFile);

export interface StoryboardFrame {
  index: number;
  timestampSeconds: number;
  imagePath: string;
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
  frames: StoryboardFrame[];
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

function pickEvenlySpacedValues(values: number[], count: number): number[] {
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

export function buildHybridTimestamps(
  durationSeconds: number,
  frameCount: number,
  candidateTimestamps: number[],
): number[] {
  const uniform = buildUniformTimestamps(durationSeconds, frameCount);
  const minSpacingSeconds = Math.max(durationSeconds / Math.max(frameCount * 6, 1), 0.6);
  const normalizedCandidates = dedupeSortedTimestamps(
    candidateTimestamps
      .filter((value) => Number.isFinite(value) && value > 0 && value < durationSeconds)
      .sort((left, right) => left - right),
  );

  if (normalizedCandidates.length === 0) {
    return uniform;
  }

  const candidateBudget = Math.min(
    normalizedCandidates.length,
    Math.max(1, Math.ceil(frameCount / 2)),
  );
  const prioritizedCandidates = pickEvenlySpacedValues(normalizedCandidates, candidateBudget);
  const fallbackGrid = buildUniformTimestamps(durationSeconds, Math.max(frameCount * 3, frameCount));
  const chosen: number[] = [];
  const addTimestamps = (values: number[]) => {
    for (const value of values) {
      if (chosen.length >= frameCount) return;
      if (canAddTimestamp(value, chosen, minSpacingSeconds)) {
        chosen.push(value);
      }
    }
  };

  addTimestamps(prioritizedCandidates);
  addTimestamps(uniform);
  addTimestamps(fallbackGrid);

  return chosen.sort((left, right) => left - right).slice(0, frameCount);
}

async function detectChangeTimestamps(videoPath: string, threshold: number): Promise<number[]> {
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
    return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    const matches = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
    if (matches.length > 0) return matches;
    return [];
  }
}

export async function extractStoryboard(input: StoryboardExtractRequest) {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? defaultOutputDir(videoPath));
  await mkdir(outputDir, { recursive: true });

  const durationSeconds = await probeDuration(videoPath);
  const detectedChangeTimestamps =
    input.samplingMode === "hybrid"
      ? await detectChangeTimestamps(videoPath, input.changeThreshold)
      : [];
  const timestamps =
    input.samplingMode === "hybrid"
      ? buildHybridTimestamps(durationSeconds, input.frameCount, detectedChangeTimestamps)
      : buildUniformTimestamps(durationSeconds, input.frameCount);
  const frames: StoryboardFrame[] = [];

  for (const [index, timestampSeconds] of timestamps.entries()) {
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
    detectedChangeCount: input.samplingMode === "hybrid" ? detectedChangeTimestamps.length : undefined,
    frames,
  };

  const manifestPath = join(outputDir, "storyboard.manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    manifestPath,
    manifest,
  };
}
