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

function buildTimestamps(durationSeconds: number, frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_, index) =>
    Number(((durationSeconds * (index + 1)) / (frameCount + 1)).toFixed(3)),
  );
}

export async function extractStoryboard(input: StoryboardExtractRequest) {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? defaultOutputDir(videoPath));
  await mkdir(outputDir, { recursive: true });

  const durationSeconds = await probeDuration(videoPath);
  const timestamps = buildTimestamps(durationSeconds, input.frameCount);
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
    frames,
  };

  const manifestPath = join(outputDir, "storyboard.manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    manifestPath,
    manifest,
  };
}
