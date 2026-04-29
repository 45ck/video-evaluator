import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { diffPngFiles } from "../core/image-diff.js";
import {
  DemoVisualReviewRequestSchema,
  GoldenFrameCompareRequestSchema,
  type DemoVisualFrameRequest,
} from "../core/schemas.js";
import type {
  DemoVisualReviewRequest,
  GoldenFrameCompareRequest,
} from "../core/schemas.js";
import {
  VISUAL_DIFF_SCHEMA_VERSION,
  type ContractDiagnostic,
  type ContractStatus,
  type MetricValue,
  type VisualDiffArtifact,
  type VisualDiffFrame,
} from "../contracts/index.js";

interface PngImage {
  width: number;
  height: number;
}

interface PngStatic {
  sync: { read: (buf: Buffer) => PngImage };
}

type VisualGateStatus = Extract<ContractStatus, "pass" | "warn" | "fail" | "skip">;

interface FramePair {
  id?: string;
  baselineFramePath: string;
  currentFramePath: string;
  timestampSeconds?: number;
}

interface VisualGatePolicy {
  pixelmatchThreshold: number;
  maxMismatchPercent: number;
  warnMismatchPercent?: number;
  missingBaselineStatus: VisualGateStatus;
  mode: "compare" | "update";
}

export interface GoldenFrameCompareResult {
  reportPath?: string;
  report: VisualDiffArtifact;
}

export interface DemoVisualReviewResult {
  reportPath?: string;
  report: VisualDiffArtifact;
}

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: PngStatic };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPngDimensions(path: string): Promise<{ width: number; height: number }> {
  const png = PNG.sync.read(await readFile(path));
  return { width: png.width, height: png.height };
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveOutputPath(input: { outputPath?: string; outputDir?: string }, filename: string): string | undefined {
  if (input.outputPath) return resolve(input.outputPath);
  if (input.outputDir) return join(resolve(input.outputDir), filename);
  return undefined;
}

async function writeReport(path: string | undefined, report: VisualDiffArtifact): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function statusRank(status: ContractStatus): number {
  if (status === "fail") return 4;
  if (status === "warn") return 3;
  if (status === "skip") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function collapseStatus(statuses: ContractStatus[]): ContractStatus {
  if (statuses.length === 0) return "skip";
  return statuses.reduce((worst, status) => (statusRank(status) > statusRank(worst) ? status : worst), "pass" as ContractStatus);
}

function thresholdStatus(mismatchPercent: number, policy: VisualGatePolicy): VisualGateStatus {
  if (mismatchPercent <= policy.maxMismatchPercent) return "pass";
  if (policy.warnMismatchPercent !== undefined && mismatchPercent <= policy.warnMismatchPercent) return "warn";
  return "fail";
}

function metric(value: number, threshold: number, status: ContractStatus, unit = "ratio"): MetricValue {
  return { value, unit, threshold, status };
}

async function maybeUpdateBaseline(pair: FramePair, policy: VisualGatePolicy, diagnostics: ContractDiagnostic[]): Promise<void> {
  if (policy.mode !== "update") return;
  await mkdir(dirname(pair.baselineFramePath), { recursive: true });
  await copyFile(pair.currentFramePath, pair.baselineFramePath);
  diagnostics.push({
    code: "baseline-updated",
    message: `Updated baseline frame for ${pair.id ?? basename(pair.currentFramePath)}.`,
    severity: "info",
    evidence: [{ framePath: pair.baselineFramePath }],
  });
}

async function compareFramePair(
  pair: FramePair,
  index: number,
  policy: VisualGatePolicy,
  diagnostics: ContractDiagnostic[],
): Promise<{ frame?: VisualDiffFrame; status: ContractStatus; note?: string }> {
  const currentExists = await exists(pair.currentFramePath);
  if (!currentExists) {
    diagnostics.push({
      code: "missing-current-frame",
      message: `Current frame is missing: ${pair.currentFramePath}`,
      severity: "error",
      evidence: [{ framePath: pair.currentFramePath }],
    });
    return { status: "fail", note: `missing current frame ${pair.currentFramePath}` };
  }

  const baselineExists = await exists(pair.baselineFramePath);
  if (!baselineExists && policy.mode !== "update") {
    diagnostics.push({
      code: "missing-baseline-frame",
      message: `Baseline frame is missing: ${pair.baselineFramePath}`,
      severity: policy.missingBaselineStatus === "fail" ? "error" : "warning",
      evidence: [{ framePath: pair.currentFramePath }],
    });
    return { status: policy.missingBaselineStatus, note: `missing baseline frame ${pair.baselineFramePath}` };
  }

  await maybeUpdateBaseline(pair, policy, diagnostics);

  const [baselineDimensions, currentDimensions] = await Promise.all([
    readPngDimensions(pair.baselineFramePath),
    readPngDimensions(pair.currentFramePath),
  ]);
  const totalPixelCount = Math.max(
    baselineDimensions.width * baselineDimensions.height,
    currentDimensions.width * currentDimensions.height,
  );

  if (
    baselineDimensions.width !== currentDimensions.width ||
    baselineDimensions.height !== currentDimensions.height
  ) {
    diagnostics.push({
      code: "dimension-mismatch",
      message: `Frame dimensions differ for ${pair.id ?? basename(pair.currentFramePath)}: baseline ${baselineDimensions.width}x${baselineDimensions.height}, current ${currentDimensions.width}x${currentDimensions.height}.`,
      severity: "error",
      evidence: [
        { framePath: pair.baselineFramePath, note: "baseline frame" },
        { framePath: pair.currentFramePath, note: "current frame" },
      ],
      metadata: { baselineDimensions, currentDimensions },
    });
    return {
      frame: {
        index,
        timestampSeconds: pair.timestampSeconds,
        leftFramePath: pair.baselineFramePath,
        rightFramePath: pair.currentFramePath,
        mismatchPixelCount: totalPixelCount,
        totalPixelCount,
        mismatchPercent: 1,
        changedRegions: [],
        evidence: [
          { framePath: pair.baselineFramePath, note: "baseline frame" },
          { framePath: pair.currentFramePath, note: "current frame" },
        ],
        metadata: { id: pair.id, status: "fail", baselineDimensions, currentDimensions },
      },
      status: "fail",
      note: `dimension mismatch for ${pair.id ?? basename(pair.currentFramePath)}`,
    };
  }

  const diff = await diffPngFiles(pair.baselineFramePath, pair.currentFramePath, policy.pixelmatchThreshold);
  const mismatchPercent = clampRatio(diff.mismatchPercent);
  const status = thresholdStatus(mismatchPercent, policy);

  return {
    frame: {
      index,
      timestampSeconds: pair.timestampSeconds,
      leftFramePath: pair.baselineFramePath,
      rightFramePath: pair.currentFramePath,
      mismatchPixelCount: diff.mismatchCount,
      totalPixelCount: diff.totalPixels,
      mismatchPercent,
      changedRegions: [],
      evidence: [
        { framePath: pair.baselineFramePath, note: "baseline frame" },
        { framePath: pair.currentFramePath, note: "current frame" },
      ],
      metadata: { id: pair.id, status },
    },
    status,
  };
}

async function compareFramePairs(input: {
  pairs: FramePair[];
  policy: VisualGatePolicy;
  outputPath?: string;
  leftName: string;
  rightName: string;
  createdAt?: Date;
}): Promise<{ reportPath?: string; report: VisualDiffArtifact }> {
  const diagnostics: ContractDiagnostic[] = [];
  const frames: VisualDiffFrame[] = [];
  const statuses: ContractStatus[] = [];
  const notes: string[] = [];

  for (const [index, pair] of input.pairs.entries()) {
    const result = await compareFramePair(pair, index, input.policy, diagnostics);
    statuses.push(result.status);
    if (result.frame) frames.push(result.frame);
    if (result.note) notes.push(result.note);
  }

  const maxMismatchPercent = frames.reduce(
    (max, frame) => Math.max(max, frame.mismatchPercent),
    0,
  );
  const averageMismatchPercent =
    frames.length > 0
      ? frames.reduce((sum, frame) => sum + frame.mismatchPercent, 0) / frames.length
      : undefined;
  const status = collapseStatus(statuses);
  const report: VisualDiffArtifact = {
    schemaVersion: VISUAL_DIFF_SCHEMA_VERSION,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    left: { name: input.leftName, path: input.pairs[0]?.baselineFramePath ?? input.leftName },
    right: { name: input.rightName, path: input.pairs[0]?.currentFramePath ?? input.rightName },
    threshold: input.policy.maxMismatchPercent,
    overallStatus: status,
    frames,
    summary: {
      comparedFrameCount: frames.length,
      averageMismatchPercent,
      maxMismatchPercent: frames.length > 0 ? maxMismatchPercent : undefined,
      metrics: {
        maxMismatchPercent: metric(maxMismatchPercent, input.policy.maxMismatchPercent, status),
        comparedFrameCount: { value: frames.length, status },
        missingBaselineCount: {
          value: diagnostics.filter((diagnostic) => diagnostic.code === "missing-baseline-frame").length,
          status,
        },
      },
      notes,
    },
    artifacts: input.outputPath
      ? [{ name: "visual-diff-report", path: input.outputPath, schemaVersion: VISUAL_DIFF_SCHEMA_VERSION }]
      : [],
    diagnostics,
    metadata: {
      mode: input.policy.mode,
      pixelmatchThreshold: input.policy.pixelmatchThreshold,
      maxMismatchPercent: input.policy.maxMismatchPercent,
      warnMismatchPercent: input.policy.warnMismatchPercent,
      missingBaselineStatus: input.policy.missingBaselineStatus,
    },
  };

  await writeReport(input.outputPath, report);
  return { reportPath: input.outputPath, report };
}

function goldenPolicy(input: GoldenFrameCompareRequest | DemoVisualReviewRequest): VisualGatePolicy {
  return {
    mode: input.mode,
    pixelmatchThreshold: input.pixelmatchThreshold,
    maxMismatchPercent: input.maxMismatchPercent,
    warnMismatchPercent: input.warnMismatchPercent,
    missingBaselineStatus: input.missingBaselineStatus,
  };
}

export async function compareGoldenFrame(input: GoldenFrameCompareRequest): Promise<GoldenFrameCompareResult> {
  const parsed = GoldenFrameCompareRequestSchema.parse(input);
  const baselineFramePath = resolve(parsed.baselineFramePath);
  const currentFramePath = resolve(parsed.currentFramePath);
  const outputPath = resolveOutputPath(parsed, "golden-frame.diff.json");
  return compareFramePairs({
    pairs: [{ baselineFramePath, currentFramePath }],
    policy: goldenPolicy(parsed),
    outputPath,
    leftName: "baseline",
    rightName: "current",
  });
}

async function listPngFrames(dir: string): Promise<DemoVisualFrameRequest[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ id: entry.name, currentFramePath: join(dir, entry.name) }));
}

function resolveDemoPairs(input: DemoVisualReviewRequest): FramePair[] {
  const baselineDir = input.baselineDir ? resolve(input.baselineDir) : undefined;
  const currentDir = input.currentDir ? resolve(input.currentDir) : undefined;
  return input.frames.map((frame) => {
    const currentFramePath = resolve(frame.currentFramePath);
    const relativeCurrent = currentDir ? relative(currentDir, currentFramePath) : basename(currentFramePath);
    const baselineFramePath = frame.baselineFramePath
      ? resolve(frame.baselineFramePath)
      : baselineDir
        ? join(baselineDir, relativeCurrent)
        : "";
    return {
      id: frame.id ?? relativeCurrent,
      baselineFramePath,
      currentFramePath,
      timestampSeconds: frame.timestampSeconds,
    };
  });
}

export async function reviewDemoVisualFrames(input: DemoVisualReviewRequest): Promise<DemoVisualReviewResult> {
  const parsed = DemoVisualReviewRequestSchema.parse(input);
  const hydratedInput =
    parsed.frames.length > 0 || !parsed.currentDir
      ? parsed
      : { ...parsed, frames: await listPngFrames(resolve(parsed.currentDir)) };
  const outputPath = resolveOutputPath(hydratedInput, "demo-visual-review.diff.json");
  return compareFramePairs({
    pairs: resolveDemoPairs(hydratedInput),
    policy: goldenPolicy(hydratedInput),
    outputPath,
    leftName: hydratedInput.baselineDir ? "baseline-dir" : "baseline-frames",
    rightName: hydratedInput.currentDir ? "current-dir" : "current-frames",
  });
}
