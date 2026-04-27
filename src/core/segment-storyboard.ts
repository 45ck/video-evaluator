import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { intakeBundle } from "./bundle.js";
import type { SegmentStoryboardRequest } from "./schemas.js";
import type { StoryboardFrame, StoryboardManifest } from "./storyboard.js";

const execFileAsync = promisify(execFile);

interface ShotRecord {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestampSeconds?: number;
}

interface VideoShotsManifest {
  durationSeconds?: number;
  shots?: ShotRecord[];
}

export interface SegmentStoryboardFrame extends StoryboardFrame {
  sourceShotIndex: number;
  segmentPosition: "early" | "middle" | "late";
}

export interface SegmentStoryboardManifest extends Omit<StoryboardManifest, "samplingMode" | "frames"> {
  samplingMode: "segment";
  framesPerSegment: number;
  sourceArtifacts: Record<string, string>;
  frames: SegmentStoryboardFrame[];
}

export function planSegmentStoryboardFrames(input: {
  shots: ShotRecord[];
  framesPerSegment: number;
}): Array<{
  sourceShotIndex: number;
  timestampSeconds: number;
  segmentPosition: SegmentStoryboardFrame["segmentPosition"];
}> {
  const frames: Array<{
    sourceShotIndex: number;
    timestampSeconds: number;
    segmentPosition: SegmentStoryboardFrame["segmentPosition"];
  }> = [];
  const framePlan =
    input.framesPerSegment === 1
      ? [{ ratio: 0.5, position: "middle" as const }]
      : input.framesPerSegment === 2
        ? [
            { ratio: 1 / 3, position: "early" as const },
            { ratio: 2 / 3, position: "late" as const },
          ]
        : [
            { ratio: 0.25, position: "early" as const },
            { ratio: 0.5, position: "middle" as const },
            { ratio: 0.75, position: "late" as const },
          ];

  for (const shot of input.shots) {
    const planned = framePlan.map((entry) => ({
      sourceShotIndex: shot.index,
      timestampSeconds:
        entry.position === "middle" && shot.representativeTimestampSeconds !== undefined
          ? clampTimestamp(shot, shot.representativeTimestampSeconds)
          : timestampAtRatio(shot, entry.ratio),
      segmentPosition: entry.position,
    }));
    for (const frame of dedupeFrames(planned)) {
      frames.push(frame);
    }
  }
  return frames;
}

export async function extractSegmentStoryboard(input: SegmentStoryboardRequest) {
  const bundle = await intakeBundle(input);
  if (!bundle.videoPath) {
    throw new Error("segment-storyboard requires a video path.");
  }
  const shotsPath = bundle.artifacts["video.shots.json"];
  if (!shotsPath) {
    throw new Error("segment-storyboard requires video.shots.json. Run video-shots first.");
  }

  const rootDir = bundle.rootDir ?? resolve(input.outputDir ?? ".");
  const outputDir = resolve(input.storyboardOutputDir ?? join(rootDir, "segment-storyboard"));
  await mkdir(outputDir, { recursive: true });

  const shotsManifest = await readJson<VideoShotsManifest>(shotsPath);
  const shots = (shotsManifest.shots ?? []).filter(
    (shot) => Number.isFinite(shot.startSeconds) && Number.isFinite(shot.endSeconds),
  );
  const framePlan = planSegmentStoryboardFrames({
    shots,
    framesPerSegment: input.framesPerSegment,
  });

  const frames: SegmentStoryboardFrame[] = [];
  for (const [index, plannedFrame] of framePlan.entries()) {
    const imagePath = join(outputDir, `frame-${String(index + 1).padStart(3, "0")}.${input.format}`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      String(plannedFrame.timestampSeconds),
      "-i",
      bundle.videoPath,
      "-frames:v",
      "1",
      imagePath,
    ]);
    frames.push({
      index: index + 1,
      timestampSeconds: plannedFrame.timestampSeconds,
      imagePath,
      samplingReason: "uniform",
      sourceShotIndex: plannedFrame.sourceShotIndex,
      segmentPosition: plannedFrame.segmentPosition,
    });
  }

  const manifest: SegmentStoryboardManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    videoPath: bundle.videoPath,
    outputDir,
    frameCount: frames.length,
    durationSeconds: shotsManifest.durationSeconds ?? inferDurationSeconds(shots),
    format: input.format,
    samplingMode: "segment",
    framesPerSegment: input.framesPerSegment,
    sourceArtifacts: {
      "video.shots.json": shotsPath,
    },
    frames,
  };

  const manifestPath = join(outputDir, "storyboard.manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest };
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function timestampAtRatio(shot: ShotRecord, ratio: number): number {
  const durationSeconds = Math.max(0, shot.endSeconds - shot.startSeconds);
  const edgeInset = Math.min(0.15, durationSeconds / 4);
  const start = shot.startSeconds + edgeInset;
  const end = shot.endSeconds - edgeInset;
  if (end <= start) return Number((shot.startSeconds + durationSeconds / 2).toFixed(3));
  return Number((start + (end - start) * ratio).toFixed(3));
}

function clampTimestamp(shot: ShotRecord, timestampSeconds: number): number {
  return Number(Math.max(shot.startSeconds, Math.min(shot.endSeconds, timestampSeconds)).toFixed(3));
}

function dedupeFrames<T extends { timestampSeconds: number }>(frames: T[]): T[] {
  const deduped: T[] = [];
  for (const frame of frames) {
    if (deduped.every((existing) => Math.abs(existing.timestampSeconds - frame.timestampSeconds) > 0.001)) {
      deduped.push(frame);
    }
  }
  return deduped;
}

function inferDurationSeconds(shots: ShotRecord[]): number {
  if (shots.length === 0) return 0;
  return Number(Math.max(...shots.map((shot) => shot.endSeconds)).toFixed(3));
}
