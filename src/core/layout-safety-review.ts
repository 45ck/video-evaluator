import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LayoutSafetyReviewRequest } from "./schemas.js";
import { extractStoryboard } from "./storyboard.js";
import {
  ocrStoryboard,
  type StoryboardOcrFrameResult,
  type StoryboardOcrLine,
} from "./storyboard-ocr.js";

export interface LayoutBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutElement {
  id: string;
  label?: string;
  role?: string;
  box: LayoutBox;
  allowOverlapWith?: string[];
  ignoreOverlap?: boolean;
}

export interface LayoutAnnotationFrame {
  index?: number;
  timeSeconds: number;
  elements: LayoutElement[];
}

export interface LayoutAnnotationsManifest {
  schemaVersion: "layout-annotations.v1";
  videoWidth?: number;
  videoHeight?: number;
  safeZones?: Record<string, LayoutBox>;
  frames: LayoutAnnotationFrame[];
}

export interface LayoutSafetyIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  timeSeconds?: number;
  details?: Record<string, unknown>;
}

export interface LayoutSafetyReport {
  schemaVersion: "layout-safety-report.v1";
  createdAt: string;
  videoPath: string;
  outputDir: string;
  layoutPath?: string;
  storyboardManifestPath: string;
  ocrPath?: string;
  sampledFrameCount: number;
  checkedLayoutFrameCount: number;
  issues: LayoutSafetyIssue[];
  metrics: {
    maxDeclaredOverlapRatio: number;
    maxCaptionZoneOverlapRatio: number;
    ocrTextOverlapCount: number;
  };
}

const DEFAULT_CAPTION_ZONE: LayoutBox = {
  x0: 0.06,
  y0: 0.7,
  x1: 0.94,
  y1: 0.86,
};
const IGNORED_ROLES = new Set([
  "background",
  "decorative",
  "particle",
  "safe-zone",
]);

function defaultOutputDir(videoPath: string): string {
  return join(dirname(resolve(videoPath)), "video-evaluator-layout-safety");
}

function normalizeBox(box: LayoutBox, width = 1, height = 1): LayoutBox {
  const isNormalized =
    Math.max(
      Math.abs(box.x0),
      Math.abs(box.y0),
      Math.abs(box.x1),
      Math.abs(box.y1),
    ) <= 1.5;
  if (isNormalized) {
    return {
      x0: Math.min(box.x0, box.x1),
      y0: Math.min(box.y0, box.y1),
      x1: Math.max(box.x0, box.x1),
      y1: Math.max(box.y0, box.y1),
    };
  }
  return {
    x0: Math.min(box.x0, box.x1) / width,
    y0: Math.min(box.y0, box.y1) / height,
    x1: Math.max(box.x0, box.x1) / width,
    y1: Math.max(box.y0, box.y1) / height,
  };
}

function area(box: LayoutBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

function intersection(left: LayoutBox, right: LayoutBox): LayoutBox {
  return {
    x0: Math.max(left.x0, right.x0),
    y0: Math.max(left.y0, right.y0),
    x1: Math.min(left.x1, right.x1),
    y1: Math.min(left.y1, right.y1),
  };
}

function overlapRatio(left: LayoutBox, right: LayoutBox): number {
  const overlapArea = area(intersection(left, right));
  if (overlapArea <= 0) return 0;
  return overlapArea / Math.max(0.000001, Math.min(area(left), area(right)));
}

function round(value: number): number {
  return Number(value.toFixed(5));
}

function issue(
  severity: LayoutSafetyIssue["severity"],
  code: string,
  message: string,
  timeSeconds: number | undefined,
  details: Record<string, unknown> = {},
): LayoutSafetyIssue {
  return { severity, code, message, timeSeconds, details };
}

function canOverlap(left: LayoutElement, right: LayoutElement): boolean {
  if (left.ignoreOverlap || right.ignoreOverlap) return true;
  if (IGNORED_ROLES.has(left.role ?? "") || IGNORED_ROLES.has(right.role ?? ""))
    return true;
  return Boolean(
    left.allowOverlapWith?.includes(right.id) ||
    right.allowOverlapWith?.includes(left.id),
  );
}

function checkDeclaredLayout(
  manifest: LayoutAnnotationsManifest,
  input: LayoutSafetyReviewRequest,
): {
  issues: LayoutSafetyIssue[];
  maxDeclaredOverlapRatio: number;
  maxCaptionZoneOverlapRatio: number;
} {
  const issues: LayoutSafetyIssue[] = [];
  let maxDeclaredOverlapRatio = 0;
  let maxCaptionZoneOverlapRatio = 0;
  const width = manifest.videoWidth ?? 1;
  const height = manifest.videoHeight ?? 1;
  const captionZone = normalizeBox(
    manifest.safeZones?.caption ?? DEFAULT_CAPTION_ZONE,
    width,
    height,
  );

  for (const frame of manifest.frames) {
    const elements = frame.elements.map((element) => ({
      ...element,
      box: normalizeBox(element.box, width, height),
    }));

    for (const element of elements) {
      const outsideFrame =
        element.box.x0 < 0 ||
        element.box.y0 < 0 ||
        element.box.x1 > 1 ||
        element.box.y1 > 1;
      if (outsideFrame) {
        issues.push(
          issue(
            "error",
            "element-outside-frame",
            `Element ${element.id} is outside the frame.`,
            frame.timeSeconds,
            {
              element,
            },
          ),
        );
      }

      if (
        element.role !== "caption" &&
        !IGNORED_ROLES.has(element.role ?? "")
      ) {
        const captionOverlap = overlapRatio(element.box, captionZone);
        maxCaptionZoneOverlapRatio = Math.max(
          maxCaptionZoneOverlapRatio,
          captionOverlap,
        );
        if (captionOverlap > input.maxCaptionZoneOverlapRatio) {
          issues.push(
            issue(
              "error",
              "caption-safe-zone-collision",
              `Element ${element.id} overlaps the caption safe zone.`,
              frame.timeSeconds,
              {
                elementId: element.id,
                role: element.role,
                overlapRatio: round(captionOverlap),
              },
            ),
          );
        }
      }
    }

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const left = elements[i]!;
        const right = elements[j]!;
        const ratio = overlapRatio(left.box, right.box);
        const allowedOverlap = canOverlap(left, right);
        if (!allowedOverlap) {
          maxDeclaredOverlapRatio = Math.max(maxDeclaredOverlapRatio, ratio);
        }
        if (ratio > input.maxPairOverlapRatio && !allowedOverlap) {
          issues.push(
            issue(
              "error",
              "declared-element-overlap",
              `${left.id} overlaps ${right.id}.`,
              frame.timeSeconds,
              {
                leftId: left.id,
                leftRole: left.role,
                rightId: right.id,
                rightRole: right.role,
                overlapRatio: round(ratio),
              },
            ),
          );
        }
      }
    }
  }

  return { issues, maxDeclaredOverlapRatio, maxCaptionZoneOverlapRatio };
}

function ocrBox(
  line: StoryboardOcrLine,
  frame: StoryboardOcrFrameResult,
): LayoutBox | null {
  if (!line.bbox || !frame.imageWidth || !frame.imageHeight) return null;
  return normalizeBox(line.bbox, frame.imageWidth, frame.imageHeight);
}

function checkOcrLayout(frames: StoryboardOcrFrameResult[]): {
  issues: LayoutSafetyIssue[];
  ocrTextOverlapCount: number;
} {
  const issues: LayoutSafetyIssue[] = [];
  let ocrTextOverlapCount = 0;
  for (const frame of frames) {
    const lines = frame.lines
      .map((line) => ({ line, box: ocrBox(line, frame) }))
      .filter(
        (item): item is { line: StoryboardOcrLine; box: LayoutBox } =>
          item.box != null,
      )
      .filter(
        (item) =>
          item.line.confidence >= 45 && item.line.text.trim().length > 1,
      );

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const left = lines[i]!;
        const right = lines[j]!;
        const ratio = overlapRatio(left.box, right.box);
        if (ratio > 0.12) {
          ocrTextOverlapCount++;
          issues.push(
            issue(
              "warning",
              "ocr-text-overlap",
              "OCR text boxes overlap in a sampled frame.",
              frame.timestampSeconds,
              {
                leftText: left.line.text,
                rightText: right.line.text,
                overlapRatio: round(ratio),
              },
            ),
          );
        }
      }
    }
  }
  return { issues, ocrTextOverlapCount };
}

async function readLayoutManifest(
  layoutPath: string,
): Promise<LayoutAnnotationsManifest> {
  const raw = await readFile(resolve(layoutPath), "utf8");
  return JSON.parse(raw) as LayoutAnnotationsManifest;
}

export async function reviewLayoutSafety(
  input: LayoutSafetyReviewRequest,
): Promise<{
  reportPath: string;
  report: LayoutSafetyReport;
}> {
  const videoPath = resolve(input.videoPath);
  const outputDir = resolve(input.outputDir ?? defaultOutputDir(videoPath));
  const storyboardDir = join(outputDir, "storyboard");
  await mkdir(outputDir, { recursive: true });

  const storyboard = await extractStoryboard({
    videoPath,
    outputDir: storyboardDir,
    frameCount: input.frameCount,
    format: "jpg",
    samplingMode: input.samplingMode,
    changeThreshold: 0.08,
  });

  const issues: LayoutSafetyIssue[] = [];
  let ocrPath: string | undefined;
  let ocrTextOverlapCount = 0;
  if (input.runOcr) {
    const ocr = await ocrStoryboard({
      storyboardDir,
      minConfidence: input.minOcrConfidence,
    });
    ocrPath = ocr.outputPath;
    const ocrResult = checkOcrLayout(ocr.manifest.frames);
    issues.push(...ocrResult.issues);
    ocrTextOverlapCount = ocrResult.ocrTextOverlapCount;
  }

  let checkedLayoutFrameCount = 0;
  let maxDeclaredOverlapRatio = 0;
  let maxCaptionZoneOverlapRatio = 0;
  if (input.layoutPath) {
    const layout = await readLayoutManifest(input.layoutPath);
    checkedLayoutFrameCount = layout.frames.length;
    const declared = checkDeclaredLayout(layout, input);
    issues.push(...declared.issues);
    maxDeclaredOverlapRatio = declared.maxDeclaredOverlapRatio;
    maxCaptionZoneOverlapRatio = declared.maxCaptionZoneOverlapRatio;
  }

  const report: LayoutSafetyReport = {
    schemaVersion: "layout-safety-report.v1",
    createdAt: new Date().toISOString(),
    videoPath,
    outputDir,
    layoutPath: input.layoutPath ? resolve(input.layoutPath) : undefined,
    storyboardManifestPath: storyboard.manifestPath,
    ocrPath,
    sampledFrameCount: storyboard.manifest.frames.length,
    checkedLayoutFrameCount,
    issues: issues.sort((left, right) =>
      right.severity.localeCompare(left.severity),
    ),
    metrics: {
      maxDeclaredOverlapRatio: round(maxDeclaredOverlapRatio),
      maxCaptionZoneOverlapRatio: round(maxCaptionZoneOverlapRatio),
      ocrTextOverlapCount,
    },
  };
  const reportPath = join(outputDir, "layout-safety.report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, report };
}
