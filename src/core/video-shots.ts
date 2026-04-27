import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { VideoShotsRequest } from "./schemas.js";

const execFileAsync = promisify(execFile);

export interface VideoShotSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestampSeconds: number;
  representativeFramePath?: string;
  boundaryStart: "video-start" | "scene-change";
  boundaryEnd: "scene-change" | "video-end";
}

export interface VideoShotsManifest {
  schemaVersion: 1;
  createdAt: string;
  videoPath: string;
  outputDir: string;
  durationSeconds: number;
  sceneThreshold: number;
  minShotDurationSeconds: number;
  detectedBoundaryCount: number;
  shots: VideoShotSegment[];
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

async function detectSceneBoundaries(videoPath: string, threshold: number): Promise<number[]> {
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
    return extractBoundaryTimes(stderr);
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    return extractBoundaryTimes(stderr);
  }
}

function extractBoundaryTimes(stderr: string): number[] {
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

export function buildShotSegments(input: {
  durationSeconds: number;
  boundaries: number[];
  minShotDurationSeconds?: number;
}): VideoShotSegment[] {
  const durationSeconds = Number(input.durationSeconds.toFixed(3));
  const minShotDurationSeconds = input.minShotDurationSeconds ?? 0.5;
  const boundaries = input.boundaries
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value >= minShotDurationSeconds &&
        durationSeconds - value >= minShotDurationSeconds,
    )
    .sort((left, right) => left - right);
  const deduped: number[] = [];
  for (const boundary of boundaries) {
    const previous = deduped[deduped.length - 1];
    if (previous === undefined || boundary - previous >= minShotDurationSeconds) {
      deduped.push(Number(boundary.toFixed(3)));
    }
  }

  const points = [0, ...deduped, durationSeconds];
  const shots: VideoShotSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const startSeconds = points[index];
    const endSeconds = points[index + 1];
    const duration = endSeconds - startSeconds;
    if (duration < minShotDurationSeconds && shots.length > 0) {
      const previous = shots[shots.length - 1];
      previous.endSeconds = endSeconds;
      previous.durationSeconds = Number((previous.endSeconds - previous.startSeconds).toFixed(3));
      previous.representativeTimestampSeconds = midpoint(previous.startSeconds, previous.endSeconds);
      previous.boundaryEnd = index === points.length - 2 ? "video-end" : "scene-change";
      continue;
    }
    shots.push({
      index: shots.length + 1,
      startSeconds,
      endSeconds,
      durationSeconds: Number(duration.toFixed(3)),
      representativeTimestampSeconds: midpoint(startSeconds, endSeconds),
      boundaryStart: index === 0 ? "video-start" : "scene-change",
      boundaryEnd: index === points.length - 2 ? "video-end" : "scene-change",
    });
  }

  return shots;
}

export async function extractVideoShots(input: VideoShotsRequest) {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? dirname(videoPath));
  const frameDir = join(outputDir, "video-shots");
  await mkdir(outputDir, { recursive: true });
  if (input.extractRepresentativeFrames) await mkdir(frameDir, { recursive: true });

  const durationSeconds = await probeDuration(videoPath);
  const boundaries = await detectSceneBoundaries(videoPath, input.sceneThreshold);
  const shots = buildShotSegments({
    durationSeconds,
    boundaries,
    minShotDurationSeconds: input.minShotDurationSeconds,
  });

  if (input.extractRepresentativeFrames) {
    for (const shot of shots) {
      const imagePath = join(frameDir, `shot-${String(shot.index).padStart(3, "0")}.jpg`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        String(shot.representativeTimestampSeconds),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        imagePath,
      ]);
      shot.representativeFramePath = imagePath;
    }
  }

  const manifest: VideoShotsManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    videoPath,
    outputDir,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    sceneThreshold: input.sceneThreshold,
    minShotDurationSeconds: input.minShotDurationSeconds,
    detectedBoundaryCount: boundaries.length,
    shots,
  };
  const manifestPath = join(outputDir, "video.shots.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest };
}

function midpoint(startSeconds: number, endSeconds: number): number {
  return Number((startSeconds + (endSeconds - startSeconds) / 2).toFixed(3));
}
