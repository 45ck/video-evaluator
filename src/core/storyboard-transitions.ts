import { mkdtemp, rm } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StoryboardTransitionsRequest } from "./schemas.js";
import { diffPngFiles } from "./image-diff.js";

const execFileAsync = promisify(execFile);

export interface TransitionOcrFrame {
  index: number;
  timestampSeconds: number;
  imagePath: string;
  samplingReason?: "uniform" | "change-peak" | "coverage-fill";
  nearestChangeDistanceSeconds?: number;
  samplingSignal?: "scene-change" | "same-screen-change";
  samplingScore?: number;
  imageWidth?: number;
  imageHeight?: number;
  lines: Array<{
    text: string;
    confidence: number;
    region?: "top" | "middle" | "bottom";
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
  }>;
  semanticLines?: Array<{
    text: string;
    confidence: number;
    region?: "top" | "middle" | "bottom";
    evidenceRole?: "ui" | "subtitle-like" | "garbage";
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
  }>;
  quality?: {
    status: "usable" | "weak" | "reject";
    reasons?: string[];
  };
}

interface OcrManifest {
  storyboardDir: string;
  videoPath: string;
  frames: TransitionOcrFrame[];
}

export interface StoryboardTransition {
  fromFrameIndex: number;
  toFrameIndex: number;
  fromTimestampSeconds: number;
  toTimestampSeconds: number;
  visualDiffPercent: number;
  overlapRatio: number;
  sharedLineCount: number;
  transitionKind: "screen-change" | "state-change" | "scroll-change" | "dialog-change" | "uncertain";
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

function normalizeLines(frame: TransitionOcrFrame): string[] {
  return getEvidenceLines(frame)
    .map((line) => line.text.trim())
    .filter(Boolean);
}

function getEvidenceLines(frame: TransitionOcrFrame) {
  if (frame.semanticLines && frame.semanticLines.length > 0) return frame.semanticLines;
  if (frame.quality?.status === "reject") return [];
  return frame.lines;
}

function normalizeTextKey(line: string): string {
  return line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const SHELL_ANCHOR_KEYWORDS = new Set(["helper", "assistant", "tracker", "portal", "studio", "documentation"]);

function extractShellAnchors(frame: TransitionOcrFrame): string[] {
  const anchors = new Set<string>();
  for (const line of getEvidenceLines(frame)) {
    if (line.region !== "top") continue;
    const tokens = normalizeTextKey(line.text)
      .split(" ")
      .filter((token) => token.length >= 2);
    const keywordIndex = tokens.findIndex((token) => SHELL_ANCHOR_KEYWORDS.has(token));
    if (keywordIndex === -1) continue;
    const sliceStart = Math.max(0, keywordIndex - 1);
    const anchor = tokens
      .slice(sliceStart, keywordIndex + 1)
      .filter((token) => token.length >= 3 || SHELL_ANCHOR_KEYWORDS.has(token))
      .join(" ");
    if (anchor) anchors.add(anchor);
  }
  return [...anchors];
}

function lineMap(frame: TransitionOcrFrame): Map<string, TransitionOcrFrame["lines"][number]> {
  const map = new Map<string, TransitionOcrFrame["lines"][number]>();
  for (const line of getEvidenceLines(frame)) {
    const key = normalizeTextKey(line.text);
    if (!key || map.has(key)) continue;
    map.set(key, line);
  }
  return map;
}

function setDiff(next: string[], prev: string[]): string[] {
  const prevSet = new Set(prev.map((line) => normalizeTextKey(line)));
  return next.filter((line) => !prevSet.has(normalizeTextKey(line)));
}

function hasAny(lines: string[], patterns: RegExp[]): boolean {
  return lines.some((line) => patterns.some((pattern) => pattern.test(line)));
}

function regionCounts(lines: Array<{ region?: "top" | "middle" | "bottom" }>) {
  return lines.reduce(
    (counts, line) => {
      const region = line.region ?? "middle";
      counts[region] += 1;
      return counts;
    },
    { top: 0, middle: 0, bottom: 0 },
  );
}

function getSharedLineInfo(previous: TransitionOcrFrame, current: TransitionOcrFrame) {
  const prevMap = lineMap(previous);
  const currentMap = lineMap(current);
  const sharedKeys = [...prevMap.keys()].filter((key) => currentMap.has(key));
  const previousShellAnchors = extractShellAnchors(previous);
  const currentShellAnchors = extractShellAnchors(current);
  const sharedShellAnchors = previousShellAnchors.filter((anchor) => currentShellAnchors.includes(anchor));
  const overlapRatio = sharedKeys.length / Math.max(1, Math.min(prevMap.size, currentMap.size));
  const sharedTopCount = sharedKeys.filter((key) => {
    const prevLine = prevMap.get(key);
    const currentLine = currentMap.get(key);
    return prevLine?.region === "top" && currentLine?.region === "top";
  }).length;
  const verticalShifts = sharedKeys
    .map((key) => {
      const prevLine = prevMap.get(key);
      const currentLine = currentMap.get(key);
      const prevHeight = previous.imageHeight || 1;
      const currentHeight = current.imageHeight || 1;
      if (!prevLine?.bbox || !currentLine?.bbox || prevHeight <= 0 || currentHeight <= 0) return null;
      return currentLine.bbox.centerY / currentHeight - prevLine.bbox.centerY / prevHeight;
    })
    .filter((value): value is number => typeof value === "number");

  return {
    prevMap,
    currentMap,
    sharedKeys,
    overlapRatio,
    sharedTopCount,
    sharedShellAnchorCount: sharedShellAnchors.length,
    verticalShifts,
  };
}

function inferGenericKind(
  previous: TransitionOcrFrame,
  current: TransitionOcrFrame,
  overlapRatio: number,
  visualDiffPercent: number,
  threshold: number,
  sharedTopCount: number,
  sharedShellAnchorCount: number,
  addedRegionCounts: ReturnType<typeof regionCounts>,
  removedRegionCounts: ReturnType<typeof regionCounts>,
  verticalShifts: number[],
): { kind: StoryboardTransition["transitionKind"]; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  const qualityRejected = previous.quality?.status === "reject" || current.quality?.status === "reject";
  const meanShift =
    verticalShifts.length > 0
      ? verticalShifts.reduce((sum, value) => sum + value, 0) / verticalShifts.length
      : 0;
  const consistentShiftCount = verticalShifts.filter(
    (value) => Math.sign(value) === Math.sign(meanShift) && Math.abs(value) >= 0.06,
  ).length;
  const sameScreenProbeSupported =
    previous.samplingSignal === "same-screen-change" ||
    current.samplingSignal === "same-screen-change";
  const probeDistanceSupported =
    (typeof previous.nearestChangeDistanceSeconds === "number" && previous.nearestChangeDistanceSeconds <= 0.35) ||
    (typeof current.nearestChangeDistanceSeconds === "number" && current.nearestChangeDistanceSeconds <= 0.35);

  if (qualityRejected) {
    evidence.push("at least one frame had rejected OCR quality, so text-based overlap is low-trust");
    if (visualDiffPercent > threshold * 6) {
      evidence.push("falling back to visual diff because OCR evidence was rejected");
      return { kind: "screen-change", confidence: 0.72, evidence };
    }
    return { kind: "uncertain", confidence: 0.36, evidence };
  }

  if (sharedTopCount > 0 && overlapRatio >= 0.5 && consistentShiftCount >= 2) {
    evidence.push("stable top-region text stayed visible while shared lines shifted vertically");
    return { kind: "scroll-change", confidence: 0.74, evidence };
  }

  if (
    sharedTopCount > 0 &&
    overlapRatio >= 0.45 &&
    addedRegionCounts.middle >= 2 &&
    removedRegionCounts.top === 0 &&
    visualDiffPercent <= threshold * 8
  ) {
    evidence.push("top-region anchor text stayed stable while middle-region content changed");
    return { kind: "dialog-change", confidence: 0.7, evidence };
  }

  if (sharedTopCount > 0 && overlapRatio >= 0.35) {
    evidence.push("some top-region anchor text remained while content changed");
    return { kind: "state-change", confidence: 0.66, evidence };
  }

  if (
    sameScreenProbeSupported &&
    probeDistanceSupported &&
    (sharedTopCount > 0 || sharedShellAnchorCount > 0) &&
    overlapRatio >= 0.08 &&
    visualDiffPercent <= threshold * 8
  ) {
    evidence.push("sampler flagged a nearby same-screen local change and shell anchors partially persisted");
    return { kind: "state-change", confidence: 0.68, evidence };
  }

  if (overlapRatio <= 0.2 || visualDiffPercent > threshold * 6) {
    evidence.push("very low text overlap or large visual delta suggests a different screen");
    return { kind: "screen-change", confidence: 0.78, evidence };
  }

  evidence.push("insufficient layout stability to classify confidently");
  return { kind: "uncertain", confidence: 0.45, evidence };
}

function inferTransition(
  previous: TransitionOcrFrame,
  current: TransitionOcrFrame,
  addedLines: string[],
  removedLines: string[],
  visualDiffPercent: number,
  threshold: number,
): {
  label: string;
  kind: StoryboardTransition["transitionKind"];
  confidence: number;
  evidence: string[];
  overlapRatio: number;
  sharedLineCount: number;
} {
  const sharedInfo = getSharedLineInfo(previous, current);
  const addedLineObjects = [...sharedInfo.currentMap.entries()]
    .filter(([key]) => !sharedInfo.prevMap.has(key))
    .map(([, line]) => line);
  const removedLineObjects = [...sharedInfo.prevMap.entries()]
    .filter(([key]) => !sharedInfo.currentMap.has(key))
    .map(([, line]) => line);
  const generic = inferGenericKind(
    previous,
    current,
    sharedInfo.overlapRatio,
    visualDiffPercent,
    threshold,
    sharedInfo.sharedTopCount,
    sharedInfo.sharedShellAnchorCount,
    regionCounts(addedLineObjects),
    regionCounts(removedLineObjects),
    sharedInfo.verticalShifts,
  );
  const evidence: string[] = [];

  if (
    hasAny(addedLines, [
      /sign in to access the system/i,
      /\bsign\s?in\b/i,
      /please sign in/i,
      /^username$/i,
      /^password$/i,
      /add printers/i,
    ])
  ) {
    evidence.push("sign-in UI text appeared");
    return {
      label: "navigated to sign-in screen",
      kind: generic.kind === "uncertain" ? "screen-change" : generic.kind,
      confidence: Math.max(0.88, generic.confidence),
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (hasAny(addedLines, [/teacher view/i]) || hasAny(removedLines, [/teacher view/i])) {
    evidence.push("teacher view label changed");
  }

  if (hasAny(addedLines, [/administration/i, /visit settings/i, /return mode/i, /integrations/i])) {
    evidence.push("admin/settings text appeared");
    return {
      label: "navigated to admin/settings view",
      kind: generic.kind === "uncertain" ? "screen-change" : generic.kind,
      confidence: Math.max(0.9, generic.confidence),
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (hasAny(addedLines, [/ict queue/i, /incoming students/i, /track visit progress/i])) {
    evidence.push("queue/status text appeared");
    return {
      label: "navigated to queue/status view",
      kind: generic.kind === "uncertain" ? "screen-change" : generic.kind,
      confidence: Math.max(0.86, generic.confidence),
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (hasAny(addedLines, [/send students/i, /selecting students for ict visit/i])) {
    evidence.push("send-students workflow text appeared");
    return {
      label: "entered send-students flow",
      kind: generic.kind === "uncertain" ? "screen-change" : generic.kind,
      confidence: Math.max(0.84, generic.confidence),
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (generic.kind === "screen-change") {
    evidence.push(`large visual/text change (${(visualDiffPercent * 100).toFixed(2)}% visual diff)`);
    return {
      label: "major screen change",
      kind: generic.kind,
      confidence: generic.confidence,
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (generic.kind === "scroll-change") {
    evidence.push("shared OCR lines moved vertically with stable top anchors");
    return {
      label: "scrolled within the same screen",
      kind: generic.kind,
      confidence: generic.confidence,
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (generic.kind === "dialog-change") {
    evidence.push("middle-region content changed while top anchors stayed stable");
    return {
      label: "opened or changed a focused panel/dialog",
      kind: generic.kind,
      confidence: generic.confidence,
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  if (addedLines.length > 0 || removedLines.length > 0 || generic.kind === "state-change") {
    evidence.push("OCR text changed between frames");
    return {
      label: "content/state changed on the same screen",
      kind: generic.kind === "uncertain" ? "state-change" : generic.kind,
      confidence: Math.max(0.62, generic.confidence),
      evidence: [...evidence, ...generic.evidence],
      overlapRatio: sharedInfo.overlapRatio,
      sharedLineCount: sharedInfo.sharedKeys.length,
    };
  }

  return {
    label: "no meaningful change inferred",
    kind: "uncertain",
    confidence: 0.3,
    evidence: generic.evidence,
    overlapRatio: sharedInfo.overlapRatio,
    sharedLineCount: sharedInfo.sharedKeys.length,
  };
}

export function classifyStoryboardTransition(
  previous: TransitionOcrFrame,
  current: TransitionOcrFrame,
  options: {
    visualDiffPercent: number;
    threshold: number;
  },
): StoryboardTransition {
  const prevLines = normalizeLines(previous);
  const currentLines = normalizeLines(current);
  const addedLines = setDiff(currentLines, prevLines).slice(0, 12);
  const removedLines = setDiff(prevLines, currentLines).slice(0, 12);
  const inferred = inferTransition(
    previous,
    current,
    addedLines,
    removedLines,
    options.visualDiffPercent,
    options.threshold,
  );

  return {
    fromFrameIndex: previous.index,
    toFrameIndex: current.index,
    fromTimestampSeconds: previous.timestampSeconds,
    toTimestampSeconds: current.timestampSeconds,
    visualDiffPercent: options.visualDiffPercent,
    overlapRatio: inferred.overlapRatio,
    sharedLineCount: inferred.sharedLineCount,
    transitionKind: inferred.kind,
    addedLines,
    removedLines,
    inferredTransition: inferred.label,
    confidence: inferred.confidence,
    evidence: inferred.evidence,
  };
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
      const transition = classifyStoryboardTransition(previous, current, {
        visualDiffPercent: diff.mismatchPercent,
        threshold: input.threshold,
      });
      transition.addedLines = addedLines;
      transition.removedLines = removedLines;
      transitions.push(transition);
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
