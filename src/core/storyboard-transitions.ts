import { mkdtemp, rm } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StoryboardTransitionsRequest } from "./schemas.js";
import { diffPngFiles } from "./image-diff.js";

const execFileAsync = promisify(execFile);

interface OcrFrame {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  lines: Array<{ text: string; confidence: number }>;
}

interface OcrManifest {
  storyboardDir: string;
  videoPath: string;
  frames: OcrFrame[];
}

export interface StoryboardTransition {
  fromFrameIndex: number;
  toFrameIndex: number;
  fromTimestampSeconds: number;
  toTimestampSeconds: number;
  visualDiffPercent: number;
  addedLines: string[];
  removedLines: string[];
  inferredTransition: string;
  confidence: number;
  evidence: string[];
}

export interface StoryboardTransitionsManifest {
  schemaVersion: 1;
  createdAt: string;
  ocrPath: string;
  storyboardDir: string;
  videoPath: string;
  threshold: number;
  transitions: StoryboardTransition[];
}

async function preprocessFrameForDiff(imagePath: string, tempDir: string): Promise<string> {
  const preppedPath = join(tempDir, `${Math.random().toString(36).slice(2)}.png`);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    imagePath,
    "-vf",
    "scale=1600:-1,format=gray",
    preppedPath,
  ]);
  return preppedPath;
}

async function readOcrManifest(request: StoryboardTransitionsRequest): Promise<{ ocrPath: string; manifest: OcrManifest }> {
  const ocrPath = resolve(request.ocrPath ?? join(request.storyboardDir!, "storyboard.ocr.json"));
  const raw = await readFile(ocrPath, "utf8");
  return {
    ocrPath,
    manifest: JSON.parse(raw) as OcrManifest,
  };
}

function normalizeLines(frame: OcrFrame): string[] {
  return frame.lines.map((line) => line.text.trim()).filter(Boolean);
}

function setDiff(next: string[], prev: string[]): string[] {
  const prevSet = new Set(prev);
  return next.filter((line) => !prevSet.has(line));
}

function hasAny(lines: string[], patterns: RegExp[]): boolean {
  return lines.some((line) => patterns.some((pattern) => pattern.test(line)));
}

function inferTransition(
  addedLines: string[],
  removedLines: string[],
  visualDiffPercent: number,
  threshold: number,
): { label: string; confidence: number; evidence: string[] } {
  const evidence: string[] = [];

  if (hasAny(addedLines, [/sign in to access the system/i, /^username$/i, /^password$/i])) {
    evidence.push("sign-in UI text appeared");
    return { label: "navigated to sign-in screen", confidence: 0.88, evidence };
  }

  if (hasAny(addedLines, [/teacher view/i]) || hasAny(removedLines, [/teacher view/i])) {
    evidence.push("teacher view label changed");
  }

  if (hasAny(addedLines, [/administration/i, /visit settings/i, /return mode/i, /integrations/i])) {
    evidence.push("admin/settings text appeared");
    return { label: "navigated to admin/settings view", confidence: 0.9, evidence };
  }

  if (hasAny(addedLines, [/ict queue/i, /incoming students/i, /track visit progress/i])) {
    evidence.push("queue/status text appeared");
    return { label: "navigated to queue/status view", confidence: 0.86, evidence };
  }

  if (hasAny(addedLines, [/send students/i, /selecting students for ict visit/i])) {
    evidence.push("send-students workflow text appeared");
    return { label: "entered send-students flow", confidence: 0.84, evidence };
  }

  if (visualDiffPercent > threshold * 6) {
    evidence.push(`large visual diff ${(visualDiffPercent * 100).toFixed(2)}%`);
    return { label: "major screen change", confidence: 0.72, evidence };
  }

  if (addedLines.length > 0 || removedLines.length > 0) {
    evidence.push("OCR text changed between frames");
    return { label: "content/state changed", confidence: 0.62, evidence };
  }

  return { label: "no meaningful change inferred", confidence: 0.3, evidence: [] };
}

export async function inferStoryboardTransitions(input: StoryboardTransitionsRequest) {
  const { ocrPath, manifest } = await readOcrManifest(input);
  const transitions: StoryboardTransition[] = [];
  const tempDir = await mkdtemp(join(tmpdir(), "video-evaluator-diff-"));

  try {
    for (let index = 1; index < manifest.frames.length; index += 1) {
      const previous = manifest.frames[index - 1]!;
      const current = manifest.frames[index]!;
      const prevLines = normalizeLines(previous);
      const currentLines = normalizeLines(current);
      const addedLines = setDiff(currentLines, prevLines).slice(0, 12);
      const removedLines = setDiff(prevLines, currentLines).slice(0, 12);
      const prevImage = await preprocessFrameForDiff(previous.imagePath, tempDir);
      const currentImage = await preprocessFrameForDiff(current.imagePath, tempDir);
      const diff = await diffPngFiles(prevImage, currentImage);
      const inferred = inferTransition(addedLines, removedLines, diff.mismatchPercent, input.threshold);

      transitions.push({
        fromFrameIndex: previous.index,
        toFrameIndex: current.index,
        fromTimestampSeconds: previous.timestampSeconds,
        toTimestampSeconds: current.timestampSeconds,
        visualDiffPercent: diff.mismatchPercent,
        addedLines,
        removedLines,
        inferredTransition: inferred.label,
        confidence: inferred.confidence,
        evidence: inferred.evidence,
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const output: StoryboardTransitionsManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ocrPath,
    storyboardDir: manifest.storyboardDir,
    videoPath: manifest.videoPath,
    threshold: input.threshold,
    transitions,
  };

  const outputPath = join(manifest.storyboardDir, "storyboard.transitions.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return {
    outputPath,
    manifest: output,
  };
}
