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
  samplingReason?: "uniform" | "change-peak" | "coverage-fill";
  nearestChangeDistanceSeconds?: number;
  samplingSignal?: "scene-change" | "same-screen-change";
  samplingScore?: number;
}

interface StoryboardManifest {
  outputDir: string;
  videoPath: string;
  samplingMode?: "uniform" | "hybrid";
  changeThreshold?: number;
  detectedChangeCount?: number;
  frames: StoryboardManifestFrame[];
}

export interface StoryboardOcrLine {
  text: string;
  confidence: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  region?: "top" | "middle" | "bottom";
}

export interface StoryboardOcrFrameResult {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  samplingReason?: "uniform" | "change-peak" | "coverage-fill";
  nearestChangeDistanceSeconds?: number;
  samplingSignal?: "scene-change" | "same-screen-change";
  samplingScore?: number;
  imageWidth?: number;
  imageHeight?: number;
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
  samplingMode?: "uniform" | "hybrid";
  changeThreshold?: number;
  detectedChangeCount?: number;
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

function clampRegion(centerY: number): "top" | "middle" | "bottom" {
  if (centerY <= 0.25) return "top";
  if (centerY >= 0.7) return "bottom";
  return "middle";
}

function normalizeBoundingBox(
  rawBox: unknown,
): StoryboardOcrLine["bbox"] | undefined {
  if (!rawBox || typeof rawBox !== "object") return undefined;
  const record = rawBox as Record<string, unknown>;
  const x0 = Number(record.x0 ?? record.left);
  const y0 = Number(record.y0 ?? record.top);
  const x1 = Number(record.x1 ?? record.right);
  const y1 = Number(record.y1 ?? record.bottom);
  if (![x0, y0, x1, y1].every((value) => Number.isFinite(value))) return undefined;
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  return {
    x0,
    y0,
    x1,
    y1,
    width,
    height,
    centerX: x0 + width / 2,
    centerY: y0 + height / 2,
  };
}

function buildBboxFromRect(left: number, top: number, width: number, height: number): StoryboardOcrLine["bbox"] {
  return {
    x0: left,
    y0: top,
    x1: left + width,
    y1: top + height,
    width: Math.max(1, width),
    height: Math.max(1, height),
    centerX: left + Math.max(1, width) / 2,
    centerY: top + Math.max(1, height) / 2,
  };
}

function extractLinesFromBlocks(
  blocks: unknown,
  minConfidence: number,
): { lines: StoryboardOcrLine[]; imageWidth: number; imageHeight: number } {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { lines: [], imageWidth: 0, imageHeight: 0 };
  }

  const rawLines: Array<{ text: string; confidence: number; bbox?: StoryboardOcrLine["bbox"] }> = [];
  let imageWidth = 0;
  let imageHeight = 0;

  for (const block of blocks as Array<Record<string, unknown>>) {
    const paragraphs = Array.isArray(block.paragraphs) ? block.paragraphs : [];
    for (const paragraph of paragraphs as Array<Record<string, unknown>>) {
      const lines = Array.isArray(paragraph.lines) ? paragraph.lines : [];
      for (const line of lines as Array<Record<string, unknown>>) {
        const text = normalizeLine(String(line.text ?? ""));
        const confidence = Number(line.confidence ?? 0);
        const bbox = normalizeBoundingBox(line.bbox);
        if (!text || !Number.isFinite(confidence) || confidence < minConfidence) continue;
        if (bbox) {
          imageWidth = Math.max(imageWidth, bbox.x1);
          imageHeight = Math.max(imageHeight, bbox.y1);
        }
        rawLines.push({ text, confidence, bbox });
      }
    }
  }

  const lines = rawLines.map((line) => ({
    ...line,
    region: line.bbox && imageHeight > 0 ? clampRegion(line.bbox.centerY / imageHeight) : undefined,
  }));

  return { lines, imageWidth, imageHeight };
}

function extractLinesFromTsv(
  tsv: unknown,
  minConfidence: number,
): { lines: StoryboardOcrLine[]; imageWidth: number; imageHeight: number } {
  if (typeof tsv !== "string" || tsv.trim().length === 0) {
    return { lines: [], imageWidth: 0, imageHeight: 0 };
  }

  const rows = tsv
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (rows.length <= 1) {
    return { lines: [], imageWidth: 0, imageHeight: 0 };
  }

  type WordRow = {
    key: string;
    text: string;
    confidence: number;
    left: number;
    top: number;
    width: number;
    height: number;
    wordNum: number;
  };

  const words: WordRow[] = [];
  let imageWidth = 0;
  let imageHeight = 0;

  for (const row of rows.slice(1)) {
    const parts = row.split("\t");
    if (parts.length < 12) continue;
    const [level, pageNum, blockNum, parNum, lineNum, wordNum, left, top, width, height, conf, ...textParts] =
      parts;
    if (Number(level) !== 5) continue;
    const text = normalizeLine(textParts.join("\t"));
    const confidence = Number(conf);
    const leftValue = Number(left);
    const topValue = Number(top);
    const widthValue = Number(width);
    const heightValue = Number(height);
    if (!text || !Number.isFinite(confidence) || confidence < minConfidence) continue;
    if (![leftValue, topValue, widthValue, heightValue].every((value) => Number.isFinite(value))) continue;
    imageWidth = Math.max(imageWidth, leftValue + widthValue);
    imageHeight = Math.max(imageHeight, topValue + heightValue);
    words.push({
      key: [pageNum, blockNum, parNum, lineNum].join("-"),
      text,
      confidence,
      left: leftValue,
      top: topValue,
      width: widthValue,
      height: heightValue,
      wordNum: Number(wordNum),
    });
  }

  const groups = new Map<string, WordRow[]>();
  for (const word of words) {
    const bucket = groups.get(word.key) ?? [];
    bucket.push(word);
    groups.set(word.key, bucket);
  }

  const lines = [...groups.values()]
    .map((bucket) => {
      const ordered = bucket.sort((a, b) => a.wordNum - b.wordNum || a.left - b.left);
      const text = normalizeLine(ordered.map((word) => word.text).join(" "));
      const left = Math.min(...ordered.map((word) => word.left));
      const top = Math.min(...ordered.map((word) => word.top));
      const right = Math.max(...ordered.map((word) => word.left + word.width));
      const bottom = Math.max(...ordered.map((word) => word.top + word.height));
      const bbox = buildBboxFromRect(left, top, right - left, bottom - top);
      return {
        text,
        confidence: Math.round(
          ordered.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, ordered.length),
        ),
        bbox,
        region: imageHeight > 0 ? clampRegion(bbox!.centerY / imageHeight) : undefined,
      } satisfies StoryboardOcrLine;
    })
    .filter((line) => line.text.length > 0);

  return { lines, imageWidth, imageHeight };
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

function extractLinesFromOcr(
  ocr: any,
  minConfidence: number,
  imageHeight: number,
  blockLines: StoryboardOcrLine[],
  tsvFallback: StoryboardOcrLine[],
): StoryboardOcrLine[] {
  if (blockLines.length > 0) return blockLines;
  if (tsvFallback.length > 0) return tsvFallback;

  const directLines: StoryboardOcrLine[] = ((ocr?.data?.lines ?? []) as Array<{ text?: string; confidence?: number }>)
    .map((line) => ({
      text: normalizeLine(line.text ?? ""),
      confidence: Number(line.confidence ?? ocr?.data?.confidence ?? 0),
      bbox: normalizeBoundingBox((line as Record<string, unknown>).bbox),
    }))
    .filter((line) => line.text.length > 0 && line.confidence >= minConfidence);

  for (const line of directLines) {
    if (line.bbox && imageHeight > 0) {
      line.region = clampRegion(line.bbox.centerY / imageHeight);
    }
  }

  if (directLines.length > 0) return directLines;

  const fallbackConfidence = Number(ocr?.data?.confidence ?? 0);
  return String(ocr?.data?.text ?? "")
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0 && fallbackConfidence >= minConfidence)
    .map((line) => ({
      text: line,
      confidence: fallbackConfidence,
      region: undefined,
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
            samplingReason: undefined,
            nearestChangeDistanceSeconds: undefined,
            samplingSignal: undefined,
            samplingScore: undefined,
          }));

    const results: StoryboardOcrFrameResult[] = [];
    for (const frame of manifestFrames) {
      const preparedImagePath = await preprocessFrameForOcr(frame.imagePath, tempDir);
      const ocr = await workerBundle.worker.recognize(preparedImagePath, {}, {
        blocks: true,
        tsv: true,
        hocr: true,
      });
      const blockResult = extractLinesFromBlocks(ocr?.data?.blocks, input.minConfidence);
      const tsvFallback = extractLinesFromTsv(ocr?.data?.tsv, input.minConfidence);
      const imageWidth = Number(
        ocr?.data?.imageSize?.width ?? blockResult.imageWidth ?? tsvFallback.imageWidth ?? 0,
      );
      const imageHeight = Number(
        ocr?.data?.imageSize?.height ?? blockResult.imageHeight ?? tsvFallback.imageHeight ?? 0,
      );
      const lines = extractLinesFromOcr(
        ocr,
        input.minConfidence,
        imageHeight,
        blockResult.lines,
        tsvFallback.lines,
      );
      const text = lines.map((line) => line.text).join("\n");
      results.push({
        index: frame.index,
        timestampSeconds: frame.timestampSeconds,
        imagePath: frame.imagePath,
        samplingReason: frame.samplingReason,
        nearestChangeDistanceSeconds: frame.nearestChangeDistanceSeconds,
        samplingSignal: frame.samplingSignal,
        samplingScore: frame.samplingScore,
        imageWidth,
        imageHeight,
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
      samplingMode: storyboard.samplingMode,
      changeThreshold: storyboard.changeThreshold,
      detectedChangeCount: storyboard.detectedChangeCount,
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
