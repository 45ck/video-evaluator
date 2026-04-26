import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTesseractWorkerEng } from "./ocr.js";
import type { StoryboardOcrRequest } from "./schemas.js";

const execFileAsync = promisify(execFile);

interface StoryboardManifestFrame {
  index: number;
  timestampSeconds: number;
  imagePath: string;
}

interface StoryboardManifest {
  outputDir: string;
  videoPath: string;
  frames: StoryboardManifestFrame[];
}

export interface StoryboardOcrLine {
  text: string;
  confidence: number;
}

export interface StoryboardOcrFrameResult {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  lines: StoryboardOcrLine[];
  text: string;
}

export interface StoryboardOcrManifest {
  schemaVersion: 1;
  createdAt: string;
  storyboardManifestPath: string;
  storyboardDir: string;
  videoPath: string;
  minConfidence: number;
  frames: StoryboardOcrFrameResult[];
  summary: {
    uniqueLines: string[];
    concatenatedText: string;
  };
}

async function resolveStoryboardManifest(input: StoryboardOcrRequest): Promise<string> {
  if (input.manifestPath) return resolve(input.manifestPath);
  return resolve(input.storyboardDir!, "storyboard.manifest.json");
}

async function readStoryboardManifest(manifestPath: string): Promise<StoryboardManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as StoryboardManifest;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function preprocessFrameForOcr(imagePath: string, tempDir: string): Promise<string> {
  const preppedPath = join(tempDir, `${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      imagePath,
      "-vf",
      "scale=2400:-1,format=gray,eq=contrast=1.5:brightness=0.05",
      preppedPath,
    ]);
    return preppedPath;
  } catch {
    return imagePath;
  }
}

function extractLinesFromOcr(ocr: any, minConfidence: number): StoryboardOcrLine[] {
  const directLines = ((ocr?.data?.lines ?? []) as Array<{ text?: string; confidence?: number }>)
    .map((line) => ({
      text: normalizeLine(line.text ?? ""),
      confidence: Number(line.confidence ?? ocr?.data?.confidence ?? 0),
    }))
    .filter((line) => line.text.length > 0 && line.confidence >= minConfidence);

  if (directLines.length > 0) return directLines;

  const fallbackConfidence = Number(ocr?.data?.confidence ?? 0);
  return String(ocr?.data?.text ?? "")
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0 && fallbackConfidence >= minConfidence)
    .map((line) => ({
      text: line,
      confidence: fallbackConfidence,
    }));
}

async function findSiblingFrames(storyboardDir: string): Promise<string[]> {
  const entries = await readdir(storyboardDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(jpg|jpeg|png)$/i.test(entry.name))
    .map((entry) => join(storyboardDir, entry.name))
    .sort();
}

export async function ocrStoryboard(input: StoryboardOcrRequest) {
  const manifestPath = await resolveStoryboardManifest(input);
  const storyboard = await readStoryboardManifest(manifestPath);
  const storyboardDir = resolve(input.storyboardDir ?? storyboard.outputDir ?? dirname(manifestPath));
  const workerBundle = await createTesseractWorkerEng();
  const tempDir = await mkdtemp(join(tmpdir(), "video-evaluator-ocr-"));

  try {
    const manifestFrames =
      storyboard.frames?.length > 0
        ? storyboard.frames
        : (await findSiblingFrames(storyboardDir)).map((imagePath, index) => ({
            index: index + 1,
            timestampSeconds: 0,
            imagePath,
          }));

    const results: StoryboardOcrFrameResult[] = [];
    for (const frame of manifestFrames) {
      const preparedImagePath = await preprocessFrameForOcr(frame.imagePath, tempDir);
      const ocr = await workerBundle.worker.recognize(preparedImagePath);
      const lines = extractLinesFromOcr(ocr, input.minConfidence);
      const text = lines.map((line) => line.text).join("\n");
      results.push({
        index: frame.index,
        timestampSeconds: frame.timestampSeconds,
        imagePath: frame.imagePath,
        lines,
        text,
      });
    }

    const uniqueLines = [...new Set(results.flatMap((frame) => frame.lines.map((line) => line.text)))];
    const summaryText = uniqueLines.join("\n");
    const output: StoryboardOcrManifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      storyboardManifestPath: manifestPath,
      storyboardDir,
      videoPath: storyboard.videoPath,
      minConfidence: input.minConfidence,
      frames: results,
      summary: {
        uniqueLines,
        concatenatedText: summaryText,
      },
    };

    const outputPath = join(storyboardDir, "storyboard.ocr.json");
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return {
      outputPath,
      manifest: output,
    };
  } finally {
    await workerBundle.worker.terminate();
    await rm(tempDir, { recursive: true, force: true });
  }
}
