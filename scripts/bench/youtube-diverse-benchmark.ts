#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { extractStoryboard, inferStoryboardTransitions, ocrStoryboard, understandStoryboard } from "../../src/index.ts";

const execFileAsync = promisify(execFile);
const MIN_YT_DLP_YEAR = 2025;

interface YtDlpRuntime {
  command: string;
  argsPrefix: string[];
  env?: NodeJS.ProcessEnv;
  usesFirefoxCookies: boolean;
}

export interface BenchmarkEntry {
  id: string;
  category: string;
  query: string;
  expectedFit: "high" | "medium" | "low";
  curationStatus?: "gold" | "provisional" | "negative-control" | "needs-retune";
  expectedAppNames?: string[];
  expectedViewHints?: string[];
  requiredSignals?: Array<"appNames" | "views" | "meaningfulFlow" | "capabilities">;
  forbiddenSignals?: Array<"appNames" | "views" | "meaningfulFlow" | "capabilities">;
  reviewNotes?: string;
  videoId?: string;
  url?: string;
  channelContains?: string;
  titleContains?: string;
  resolvedAt?: string;
  startSeconds?: number;
  clipSeconds?: number;
}

interface ResolvedVideo {
  id: string;
  url: string;
  title: string;
  channel?: string;
  durationSeconds?: number;
  resolutionMode: "pinned-url" | "pinned-video-id" | "query-search";
}

export interface BenchmarkConfig {
  manifestPath: string;
  outputRoot: string;
  limit?: number;
  frameCount: number;
  clipSeconds: number;
  changeThreshold: number;
  minConfidence: number;
  gateThresholds: BenchmarkGateThresholds;
}

export interface BenchmarkCaseReport {
  status: "ok" | "error";
  id: string;
  category: string;
  expectedFit: "high" | "medium" | "low";
  query: string;
  title?: string;
  url?: string;
  channel?: string;
  resolutionMode?: ResolvedVideo["resolutionMode"];
  sourceDurationSeconds?: number;
  startSeconds: number;
  clipSeconds: number;
  downloadPath?: string;
  samplePath?: string;
  storyboardDir?: string;
  elapsedSeconds?: number;
  sampleSizeBytes?: number;
  appNames: string[];
  views: string[];
  ocrQuality?: {
    usableFrameShare: number;
    weakFrameShare: number;
    rejectedFrameShare: number;
    lowSignal: boolean;
  };
  textDominance?: {
    likelyNarrationDominated: boolean;
    dominantRegion?: "top" | "middle" | "bottom" | "mixed";
    narrationLikeLineShare: number;
    narrationLikeFrameShare: number;
  };
  interactionSegments: Array<{
    summary: string;
    transitionKinds: string[];
    evidence: string[];
  }>;
  likelyFlow: string[];
  likelyCapabilities: string[];
  semanticPass?: boolean;
  notes: string[];
  error?: string;
}

export interface BenchmarkAggregateReport {
  generatedAt: string;
  manifestPath: string;
  outputRoot: string;
  caseCount: number;
  successCount: number;
  failureCount: number;
  averageElapsedSeconds?: number;
  metrics: {
    withAppNames: number;
    withViews: number;
    semanticPassCount: number;
    narrationDominatedCases: number;
    lowSignalCases: number;
    withInteractionSegments: number;
    withMeaningfulInteractionSegments: number;
    withLikelyFlow: number;
    withMeaningfulLikelyFlow: number;
    withCapabilities: number;
  };
  fitBreakdown: Record<
    BenchmarkEntry["expectedFit"],
    {
      total: number;
      ok: number;
      semanticPass: number;
      withAppNames: number;
      withInteractionSegments: number;
      withLikelyFlow: number;
      withMeaningfulLikelyFlow: number;
    }
  >;
  gate?: BenchmarkGateReport;
  reports: BenchmarkCaseReport[];
}

export interface BenchmarkGateThresholds {
  minOperationalSuccesses?: number;
  maxNegativeControlFalsePositives?: number;
  minGoldHighFitSemanticPasses?: number;
}

export interface BenchmarkGateCheck {
  name: string;
  passed: boolean;
  actual: number;
  threshold: number;
  comparison: ">=" | "<=";
  applicableCount?: number;
}

export interface BenchmarkGateReport {
  enabled: boolean;
  passed: boolean;
  checks: BenchmarkGateCheck[];
}

function parseOptionalNumberFlag(argv: string[], flag: string) {
  const rawValue = argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
  if (rawValue === undefined) return undefined;
  if (rawValue.trim() === "") {
    throw new Error(`${flag} must be a number.`);
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} must be a number.`);
  }
  return value;
}

function parseOptionalNonnegativeIntegerFlag(argv: string[], flag: string) {
  const value = parseOptionalNumberFlag(argv, flag);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return value;
}

export function parseArgs(argv: string[]) {
  const manifestPath =
    argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length) ??
    "benchmarks/youtube-diverse-queries.json";
  const outputRoot =
    argv.find((arg) => arg.startsWith("--output-root="))?.slice("--output-root=".length) ??
    "/home/calvin/tmp/video-evaluator-youtube-benchmark";
  const limitArg = parseOptionalNumberFlag(argv, "--limit");
  const frameCountArg = parseOptionalNumberFlag(argv, "--frame-count");
  const clipSecondsArg = parseOptionalNumberFlag(argv, "--clip-seconds");
  const changeThresholdArg = parseOptionalNumberFlag(argv, "--change-threshold");
  const minConfidenceArg = parseOptionalNumberFlag(argv, "--min-confidence");
  const minOperationalSuccesses = parseOptionalNonnegativeIntegerFlag(argv, "--min-operational-successes");
  const maxNegativeControlFalsePositives = parseOptionalNonnegativeIntegerFlag(
    argv,
    "--max-negative-control-false-positives",
  );
  const minGoldHighFitSemanticPasses = parseOptionalNonnegativeIntegerFlag(
    argv,
    "--min-gold-high-fit-semantic-passes",
  );
  return {
    manifestPath: resolve(manifestPath),
    outputRoot: resolve(outputRoot),
    limit: limitArg,
    frameCount: frameCountArg ?? 8,
    clipSeconds: clipSecondsArg ?? 75,
    changeThreshold: changeThresholdArg ?? 0.08,
    minConfidence: minConfidenceArg ?? 45,
    gateThresholds: {
      ...(minOperationalSuccesses !== undefined ? { minOperationalSuccesses } : {}),
      ...(maxNegativeControlFalsePositives !== undefined ? { maxNegativeControlFalsePositives } : {}),
      ...(minGoldHighFitSemanticPasses !== undefined ? { minGoldHighFitSemanticPasses } : {}),
    },
  } satisfies BenchmarkConfig;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseYtDlpYear(version: string) {
  const year = Number(version.trim().split(".")[0]);
  return Number.isFinite(year) ? year : undefined;
}

function normalizeText(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function detectFirefoxCookies() {
  return pathExists(resolve("/home/calvin/.mozilla/firefox/profiles.ini"));
}

async function ensureModernYtDlp(toolingRoot: string): Promise<Pick<YtDlpRuntime, "command" | "argsPrefix" | "env">> {
  const targetDir = join(toolingRoot, "yt-dlp-python");
  const targetVersionFile = join(targetDir, ".version");
  const existingVersion = (await pathExists(targetVersionFile))
    ? (await readFile(targetVersionFile, "utf8")).trim()
    : undefined;
  if (!existingVersion || parseYtDlpYear(existingVersion) === undefined || parseYtDlpYear(existingVersion)! < MIN_YT_DLP_YEAR) {
    await mkdir(targetDir, { recursive: true });
    await execFileAsync(
      "python3",
      ["-m", "pip", "install", "--upgrade", "--target", targetDir, "yt-dlp"],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    const { stdout } = await execFileAsync("python3", ["-m", "yt_dlp", "--version"], {
      env: {
        ...process.env,
        PYTHONPATH: targetDir,
      },
      maxBuffer: 1024 * 1024,
    });
    await writeFile(targetVersionFile, stdout.trim(), "utf8");
  }

  return {
    command: "python3",
    argsPrefix: ["-m", "yt_dlp"],
    env: {
      ...process.env,
      PYTHONPATH: targetDir,
    },
  };
}

async function getYtDlpRuntime(toolingRoot: string): Promise<YtDlpRuntime> {
  const usesFirefoxCookies = await detectFirefoxCookies();
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--version"], { maxBuffer: 1024 * 1024 });
    const year = parseYtDlpYear(stdout);
    if (year !== undefined && year >= MIN_YT_DLP_YEAR) {
      return {
        command: "yt-dlp",
        argsPrefix: [],
        usesFirefoxCookies,
      };
    }
  } catch {}

  const runtime = await ensureModernYtDlp(toolingRoot);
  return {
    ...runtime,
    usesFirefoxCookies,
  };
}

async function runYtDlp(
  runtime: YtDlpRuntime,
  args: string[],
  options?: { maxBuffer?: number },
) {
  return execFileAsync(runtime.command, [...runtime.argsPrefix, ...args], {
    env: runtime.env,
    maxBuffer: options?.maxBuffer ?? 1024 * 1024 * 8,
  });
}

async function inspectVideoTarget(
  runtime: YtDlpRuntime,
  target: string,
  resolutionMode: ResolvedVideo["resolutionMode"],
): Promise<ResolvedVideo> {
  const { stdout } = await runYtDlp(runtime, ["--dump-single-json", "--no-warnings", "--skip-download", target], {
    maxBuffer: 1024 * 1024 * 16,
  });
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const id = String(parsed.id);
  return {
    id,
    url:
      typeof parsed.webpage_url === "string" && parsed.webpage_url.length > 0
        ? parsed.webpage_url
        : `https://www.youtube.com/watch?v=${id}`,
    title: String(parsed.title),
    channel:
      typeof parsed.channel === "string"
        ? parsed.channel
        : typeof parsed.uploader === "string"
          ? parsed.uploader
          : undefined,
    durationSeconds:
      typeof parsed.duration === "number"
        ? parsed.duration
        : parsed.duration
          ? Number(parsed.duration)
          : undefined,
    resolutionMode,
  };
}

function scoreSearchCandidate(entry: BenchmarkEntry, candidate: Record<string, unknown>) {
  let score = 0;
  const title = normalizeText(typeof candidate.title === "string" ? candidate.title : undefined);
  const channel = normalizeText(
    typeof candidate.channel === "string"
      ? candidate.channel
      : typeof candidate.uploader === "string"
        ? candidate.uploader
        : undefined,
  );
  const titleContains = normalizeText(entry.titleContains);
  const channelContains = normalizeText(entry.channelContains);
  const durationSeconds =
    typeof candidate.duration === "number"
      ? candidate.duration
      : candidate.duration
        ? Number(candidate.duration)
        : undefined;
  const neededDuration = (entry.startSeconds ?? 0) + (entry.clipSeconds ?? 75);

  if (titleContains && title.includes(titleContains)) score += 8;
  if (channelContains && channel.includes(channelContains)) score += 8;

  const queryTokens = normalizeText(entry.query)
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  score += queryTokens.filter((token) => title.includes(token)).length;

  if (typeof durationSeconds === "number") {
    if (durationSeconds >= neededDuration + 10) score += 2;
    else score -= 6;
    if (durationSeconds > 60 * 60 * 2) score -= 3;
  }

  if (/\b(full course|100 days|movie|compilation)\b/i.test(title)) score -= 3;
  if (entry.expectedFit === "high" && /\b(highlights|live|concert|performance)\b/i.test(title)) score -= 4;

  return score;
}

async function resolveVideo(runtime: YtDlpRuntime, entry: BenchmarkEntry): Promise<ResolvedVideo> {
  if (entry.url) {
    return inspectVideoTarget(runtime, entry.url, "pinned-url");
  }
  if (entry.videoId) {
    return inspectVideoTarget(runtime, `https://www.youtube.com/watch?v=${entry.videoId}`, "pinned-video-id");
  }

  const { stdout } = await runYtDlp(runtime, ["--flat-playlist", "-J", `ytsearch5:${entry.query}`], {
    maxBuffer: 1024 * 1024 * 8,
  });
  const parsed = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> };
  const candidate = [...(parsed.entries ?? [])]
    .sort((left, right) => scoreSearchCandidate(entry, right) - scoreSearchCandidate(entry, left))[0];
  if (!candidate) throw new Error(`No video found for query: ${entry.query}`);
  const id = String(candidate.id);
  return {
    id,
    url:
      typeof candidate.webpage_url === "string" && candidate.webpage_url.length > 0
        ? candidate.webpage_url
        : `https://www.youtube.com/watch?v=${id}`,
    title: String(candidate.title),
    channel:
      typeof candidate.channel === "string"
        ? candidate.channel
        : typeof candidate.uploader === "string"
          ? candidate.uploader
          : undefined,
    durationSeconds:
      typeof candidate.duration === "number"
        ? candidate.duration
        : candidate.duration
          ? Number(candidate.duration)
          : undefined,
    resolutionMode: "query-search",
  };
}

async function downloadVideo(runtime: YtDlpRuntime, url: string, caseDir: string) {
  const template = join(caseDir, "download.%(ext)s");
  const sharedArgs = [
    "--no-progress",
    "--no-warnings",
    ...(runtime.usesFirefoxCookies ? ["--cookies-from-browser", "firefox"] : []),
    "-o",
    template,
    url,
  ];

  let lastError: unknown;
  for (const formatSelector of ["18/b[ext=mp4][height<=480]/b[height<=480]/b", "best[height<=480]/best"]) {
    try {
      await runYtDlp(
        runtime,
        [
          ...sharedArgs,
          "-f",
          formatSelector,
          "--merge-output-format",
          "mp4",
        ],
        { maxBuffer: 1024 * 1024 * 16 },
      );
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;

  const files = await readdir(caseDir);
  const downloadFile = files
    .filter((file) => file.startsWith("download."))
    .map((file) => join(caseDir, file))
    .sort()[0];
  if (!downloadFile) throw new Error(`Download missing for ${url}`);
  return downloadFile;
}

async function clipVideo(inputPath: string, outputPath: string, startSeconds: number, clipSeconds: number) {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(startSeconds),
      "-i",
      inputPath,
      "-t",
      String(clipSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { maxBuffer: 1024 * 1024 * 8 },
  );
}

function scoreNotes(report: BenchmarkCaseReport) {
  const notes: string[] = [];
  if (report.status !== "ok") {
    notes.push("Benchmark case failed before summary generation.");
    return notes;
  }
  if (report.appNames.length === 0) notes.push("No stable app/shell label recovered.");
  if (report.likelyFlow.length === 0) notes.push("No high-confidence flow was inferred.");
  if (report.interactionSegments.length === 0) notes.push("No grouped interaction segment was inferred.");
  if (report.expectedFit === "high" && report.appNames.length === 0) {
    notes.push("High-fit sample underperformed for UI understanding.");
  }
  if (report.textDominance?.likelyNarrationDominated) {
    notes.push("OCR appears narration/subtitle-dominated, so label extraction is likely low-signal.");
  }
  if (report.ocrQuality?.lowSignal) {
    notes.push("OCR quality was low-signal after filtering, so semantic recovery was intentionally conservative.");
  }
  if (report.likelyFlow.length > 0 && !hasMeaningfulLikelyFlow(report)) {
    notes.push("Flow output only showed generic screen-change jumps, so it was not counted as meaningful flow success.");
  }
  if (report.interactionSegments.length > 0 && !hasMeaningfulInteractionSegments(report)) {
    notes.push("Interaction segments were present, but all segment transitions were generic screen-change labels.");
  }
  if (report.expectedFit === "low" && report.likelyFlow.length > 0) {
    notes.push("Low-fit sample still produced structured flow output.");
  }
  return notes;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function evaluateSemanticPass(entry: BenchmarkEntry, report: BenchmarkCaseReport) {
  if (report.status !== "ok") return false;
  if (!entry.curationStatus || entry.curationStatus === "needs-retune") return false;

  const appNameKeys = new Set(report.appNames.map(normalizeKey));
  const viewText = report.views.map(normalizeKey).join(" || ");
  const capabilityText = report.likelyCapabilities.map(normalizeKey).join(" || ");
  const requiredSignals = entry.requiredSignals ?? [];
  const forbiddenSignals = entry.forbiddenSignals ?? [];

  for (const expected of entry.expectedAppNames ?? []) {
    if (!appNameKeys.has(normalizeKey(expected))) return false;
  }

  for (const expected of entry.expectedViewHints ?? []) {
    if (!viewText.includes(normalizeKey(expected))) return false;
  }

  for (const signal of requiredSignals) {
    if (signal === "appNames" && report.appNames.length === 0) return false;
    if (signal === "views" && report.views.length === 0) return false;
    if (signal === "meaningfulFlow" && !hasMeaningfulLikelyFlow(report)) return false;
    if (signal === "capabilities" && report.likelyCapabilities.length === 0) return false;
  }

  for (const signal of forbiddenSignals) {
    if (signal === "appNames" && report.appNames.length > 0) return false;
    if (signal === "views" && report.views.length > 0) return false;
    if (signal === "meaningfulFlow" && hasMeaningfulLikelyFlow(report)) return false;
    if (signal === "capabilities" && capabilityText.length > 0) return false;
  }

  return true;
}

function hasSignal(
  report: Pick<BenchmarkCaseReport, "appNames" | "views" | "interactionSegments" | "likelyFlow" | "likelyCapabilities">,
  signal: NonNullable<BenchmarkEntry["forbiddenSignals"]>[number],
) {
  if (signal === "appNames") return report.appNames.length > 0;
  if (signal === "views") return report.views.length > 0;
  if (signal === "meaningfulFlow") return hasMeaningfulLikelyFlow(report);
  return report.likelyCapabilities.length > 0;
}

export function isNegativeControlFalsePositive(entry: BenchmarkEntry, report: BenchmarkCaseReport) {
  if (entry.curationStatus !== "negative-control" || report.status !== "ok") return false;
  const forbiddenSignals = entry.forbiddenSignals ?? ["appNames", "views", "meaningfulFlow", "capabilities"];
  return forbiddenSignals.some((signal) => hasSignal(report, signal));
}

function isGoldHighFitCase(entry: BenchmarkEntry) {
  return entry.curationStatus === "gold" && entry.expectedFit === "high";
}

export function evaluateBenchmarkGate(
  entries: BenchmarkEntry[],
  aggregate: BenchmarkAggregateReport,
  thresholds: BenchmarkGateThresholds,
): BenchmarkGateReport {
  const checks: BenchmarkGateCheck[] = [];
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  if (thresholds.minOperationalSuccesses !== undefined) {
    checks.push({
      name: "min-operational-successes",
      passed: aggregate.successCount >= thresholds.minOperationalSuccesses,
      actual: aggregate.successCount,
      threshold: thresholds.minOperationalSuccesses,
      comparison: ">=",
      applicableCount: aggregate.caseCount,
    });
  }

  if (thresholds.maxNegativeControlFalsePositives !== undefined) {
    const negativeControlReports = aggregate.reports.filter((report) => {
      const entry = entriesById.get(report.id);
      return entry?.curationStatus === "negative-control";
    });
    const falsePositiveCount = negativeControlReports.filter((report) => {
      const entry = entriesById.get(report.id);
      return entry ? isNegativeControlFalsePositive(entry, report) : false;
    }).length;
    checks.push({
      name: "max-negative-control-false-positives",
      passed: falsePositiveCount <= thresholds.maxNegativeControlFalsePositives,
      actual: falsePositiveCount,
      threshold: thresholds.maxNegativeControlFalsePositives,
      comparison: "<=",
      applicableCount: negativeControlReports.length,
    });
  }

  if (thresholds.minGoldHighFitSemanticPasses !== undefined) {
    const goldHighFitReports = aggregate.reports.filter((report) => {
      const entry = entriesById.get(report.id);
      return entry ? isGoldHighFitCase(entry) : false;
    });
    const semanticPassCount = goldHighFitReports.filter((report) => report.semanticPass).length;
    checks.push({
      name: "min-gold-high-fit-semantic-passes",
      passed: semanticPassCount >= thresholds.minGoldHighFitSemanticPasses,
      actual: semanticPassCount,
      threshold: thresholds.minGoldHighFitSemanticPasses,
      comparison: ">=",
      applicableCount: goldHighFitReports.length,
    });
  }

  return {
    enabled: checks.length > 0,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function hasMeaningfulLikelyFlow(report: Pick<BenchmarkCaseReport, "interactionSegments" | "likelyFlow">) {
  if (report.interactionSegments.some((segment) => segment.transitionKinds.some((kind) => kind !== "screen-change"))) {
    return true;
  }
  return report.likelyFlow.some((line) => /\b(state-change|scroll-change|dialog-change)\b/.test(line));
}

function hasMeaningfulInteractionSegments(report: Pick<BenchmarkCaseReport, "interactionSegments">) {
  return report.interactionSegments.some((segment) => segment.transitionKinds.some((kind) => kind !== "screen-change"));
}

function renderMarkdown(aggregate: BenchmarkAggregateReport) {
  const lines: string[] = [];
  lines.push("# YouTube Diverse Benchmark");
  lines.push("");
  lines.push(`- Cases: ${aggregate.caseCount}`);
  lines.push(`- Successes: ${aggregate.successCount}`);
  lines.push(`- Failures: ${aggregate.failureCount}`);
  if (typeof aggregate.averageElapsedSeconds === "number") {
    lines.push(`- Average elapsed seconds: ${aggregate.averageElapsedSeconds}`);
  }
  lines.push(`- App names recovered: ${aggregate.metrics.withAppNames}/${aggregate.successCount}`);
  lines.push(`- Views recovered: ${aggregate.metrics.withViews}/${aggregate.successCount}`);
  lines.push(`- Semantic benchmark passes: ${aggregate.metrics.semanticPassCount}/${aggregate.successCount}`);
  lines.push(`- Narration-dominated cases: ${aggregate.metrics.narrationDominatedCases}/${aggregate.successCount}`);
  lines.push(`- Low-signal OCR cases: ${aggregate.metrics.lowSignalCases}/${aggregate.successCount}`);
  lines.push(`- Interaction segments recovered: ${aggregate.metrics.withInteractionSegments}/${aggregate.successCount}`);
  lines.push(
    `- Meaningful interaction segments recovered: ${aggregate.metrics.withMeaningfulInteractionSegments}/${aggregate.successCount} ` +
      "(generic all-screen-change segments excluded)",
  );
  lines.push(`- Likely flow recovered: ${aggregate.metrics.withLikelyFlow}/${aggregate.successCount}`);
  lines.push(
    `- Meaningful likely flow recovered: ${aggregate.metrics.withMeaningfulLikelyFlow}/${aggregate.successCount} ` +
      "(generic all-screen-change flows excluded)",
  );
  if (aggregate.gate?.enabled) {
    lines.push(`- Gate: ${aggregate.gate.passed ? "passed" : "failed"}`);
    for (const check of aggregate.gate.checks) {
      const applicable = check.applicableCount === undefined ? "" : `, applicable ${check.applicableCount}`;
      lines.push(
        `- Gate ${check.name}: ${check.passed ? "passed" : "failed"} ` +
          `(actual ${check.actual} ${check.comparison} threshold ${check.threshold}${applicable})`,
      );
    }
  }
  lines.push("");
  lines.push("## Fit Breakdown");
  lines.push("");
  for (const [fit, stats] of Object.entries(aggregate.fitBreakdown)) {
    lines.push(
      `- ${fit}: ${stats.ok}/${stats.total} ok, semantic pass ${stats.semanticPass}, app names ${stats.withAppNames}, ` +
        `segments ${stats.withInteractionSegments}, flow ${stats.withLikelyFlow}, ` +
        `meaningful flow ${stats.withMeaningfulLikelyFlow}`,
    );
  }
  lines.push("");
  for (const report of aggregate.reports) {
    lines.push(`## ${report.id}`);
    lines.push(`- Status: ${report.status}`);
    lines.push(`- Category: ${report.category}`);
    lines.push(`- Expected fit: ${report.expectedFit}`);
    if (report.semanticPass !== undefined) lines.push(`- Semantic pass: ${report.semanticPass}`);
    lines.push(`- Title: ${report.title ?? "unresolved"}`);
    lines.push(`- URL: ${report.url ?? "unresolved"}`);
    if (report.channel) lines.push(`- Channel: ${report.channel}`);
    if (report.resolutionMode) lines.push(`- Resolution mode: ${report.resolutionMode}`);
    lines.push(`- Start seconds: ${report.startSeconds}`);
    lines.push(`- Clip seconds: ${report.clipSeconds}`);
    if (typeof report.elapsedSeconds === "number") lines.push(`- Elapsed seconds: ${report.elapsedSeconds}`);
    if (typeof report.sampleSizeBytes === "number") lines.push(`- Sample size bytes: ${report.sampleSizeBytes}`);
    if (report.status !== "ok") {
      lines.push(`- Error: ${report.error ?? "unknown error"}`);
      if (report.notes.length > 0) lines.push(`- Notes: ${report.notes.join(" | ")}`);
      lines.push("");
      continue;
    }
    lines.push(`- App names: ${report.appNames.join(", ") || "none"}`);
    lines.push(`- Views: ${report.views.join(", ") || "none"}`);
    if (report.textDominance) {
      lines.push(
        `- Text dominance: narration=${report.textDominance.likelyNarrationDominated}, region=${report.textDominance.dominantRegion ?? "mixed"}, line share=${report.textDominance.narrationLikeLineShare}`,
      );
    }
    if (report.ocrQuality) {
      lines.push(
        `- OCR quality: usable=${report.ocrQuality.usableFrameShare}, weak=${report.ocrQuality.weakFrameShare}, rejected=${report.ocrQuality.rejectedFrameShare}, lowSignal=${report.ocrQuality.lowSignal}`,
      );
    }
    lines.push(`- Interaction segments: ${report.interactionSegments.length}`);
    for (const segment of report.interactionSegments.slice(0, 3)) {
      lines.push(`  - ${segment.summary}`);
      if (segment.evidence.length > 0) lines.push(`    - Evidence: ${segment.evidence.join(" | ")}`);
    }
    lines.push(`- Likely flow count: ${report.likelyFlow.length}`);
    for (const flowLine of report.likelyFlow.slice(0, 4)) {
      lines.push(`  - ${flowLine}`);
    }
    lines.push(`- Capability claims: ${report.likelyCapabilities.join(" | ") || "none"}`);
    if (report.notes.length > 0) {
      lines.push(`- Notes: ${report.notes.join(" | ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildAggregateReport(config: BenchmarkConfig, reports: BenchmarkCaseReport[]): BenchmarkAggregateReport {
  const okReports = reports.filter((report) => report.status === "ok");
  const fitBreakdown: BenchmarkAggregateReport["fitBreakdown"] = {
    high: { total: 0, ok: 0, semanticPass: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0, withMeaningfulLikelyFlow: 0 },
    medium: { total: 0, ok: 0, semanticPass: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0, withMeaningfulLikelyFlow: 0 },
    low: { total: 0, ok: 0, semanticPass: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0, withMeaningfulLikelyFlow: 0 },
  };

  for (const report of reports) {
    const bucket = fitBreakdown[report.expectedFit];
    bucket.total += 1;
    if (report.status !== "ok") continue;
    bucket.ok += 1;
    if (report.semanticPass) bucket.semanticPass += 1;
    if (report.appNames.length > 0) bucket.withAppNames += 1;
    if (report.interactionSegments.length > 0) bucket.withInteractionSegments += 1;
    if (report.likelyFlow.length > 0) bucket.withLikelyFlow += 1;
    if (hasMeaningfulLikelyFlow(report)) bucket.withMeaningfulLikelyFlow += 1;
  }

  const averageElapsedSeconds =
    okReports.length > 0
      ? Number(
          (
            okReports.reduce((sum, report) => sum + (report.elapsedSeconds ?? 0), 0) /
            Math.max(1, okReports.length)
          ).toFixed(2),
        )
      : undefined;

  return {
    generatedAt: new Date().toISOString(),
    manifestPath: config.manifestPath,
    outputRoot: config.outputRoot,
    caseCount: reports.length,
    successCount: okReports.length,
    failureCount: reports.length - okReports.length,
    averageElapsedSeconds,
    metrics: {
      withAppNames: okReports.filter((report) => report.appNames.length > 0).length,
      withViews: okReports.filter((report) => report.views.length > 0).length,
      semanticPassCount: okReports.filter((report) => report.semanticPass).length,
      narrationDominatedCases: okReports.filter((report) => report.textDominance?.likelyNarrationDominated).length,
      lowSignalCases: okReports.filter((report) => report.ocrQuality?.lowSignal).length,
      withInteractionSegments: okReports.filter((report) => report.interactionSegments.length > 0).length,
      withMeaningfulInteractionSegments: okReports.filter((report) => hasMeaningfulInteractionSegments(report)).length,
      withLikelyFlow: okReports.filter((report) => report.likelyFlow.length > 0).length,
      withMeaningfulLikelyFlow: okReports.filter((report) => hasMeaningfulLikelyFlow(report)).length,
      withCapabilities: okReports.filter((report) => report.likelyCapabilities.length > 0).length,
    },
    fitBreakdown,
    reports,
  };
}

async function run() {
  const config = parseArgs(process.argv.slice(2));
  const { manifestPath, outputRoot, limit } = config;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BenchmarkEntry[];
  const entries = typeof limit === "number" && Number.isFinite(limit) ? manifest.slice(0, limit) : manifest;

  await mkdir(outputRoot, { recursive: true });
  const ytDlpRuntime = await getYtDlpRuntime(join(outputRoot, ".tooling"));

  const reports: BenchmarkCaseReport[] = [];
  for (const entry of entries) {
    const caseDir = join(outputRoot, entry.id);
    await rm(caseDir, { recursive: true, force: true });
    await mkdir(caseDir, { recursive: true });
    const startedAt = Date.now();

    try {
      const resolved = await resolveVideo(ytDlpRuntime, entry);
      const downloadPath = await downloadVideo(ytDlpRuntime, resolved.url, caseDir);
      const samplePath = join(caseDir, "sample.mp4");
      await clipVideo(downloadPath, samplePath, entry.startSeconds ?? 0, entry.clipSeconds ?? config.clipSeconds);

      const storyboardDir = join(caseDir, "storyboard");
      await mkdir(storyboardDir, { recursive: true });
      await extractStoryboard({
        videoPath: samplePath,
        outputDir: storyboardDir,
        frameCount: config.frameCount,
        format: "jpg",
        samplingMode: "hybrid",
        changeThreshold: config.changeThreshold,
      });
      await ocrStoryboard({ storyboardDir, minConfidence: config.minConfidence });
      await inferStoryboardTransitions({ storyboardDir, threshold: 0.02 });
      const summary = await understandStoryboard({ storyboardDir });

      const sampleStat = await stat(samplePath);
      const report: BenchmarkCaseReport = {
        status: "ok",
        id: entry.id,
        category: entry.category,
        expectedFit: entry.expectedFit,
        query: entry.query,
        title: resolved.title,
        url: resolved.url,
        channel: resolved.channel,
        resolutionMode: resolved.resolutionMode,
        sourceDurationSeconds: resolved.durationSeconds,
        startSeconds: entry.startSeconds ?? 0,
        clipSeconds: entry.clipSeconds ?? config.clipSeconds,
        downloadPath,
        samplePath,
        storyboardDir,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        sampleSizeBytes: sampleStat.size,
        appNames: summary.manifest.appNames,
        views: summary.manifest.views,
        ocrQuality: summary.manifest.ocrQuality,
        textDominance: summary.manifest.textDominance,
        interactionSegments: summary.manifest.interactionSegments.map((segment) => ({
          summary: segment.summary,
          transitionKinds: segment.transitionKinds,
          evidence: segment.evidence,
        })),
        likelyFlow: summary.manifest.likelyFlow,
        likelyCapabilities: summary.manifest.likelyCapabilities.map((claim) => claim.claim),
        semanticPass: false,
        notes: [],
      };
      report.semanticPass = evaluateSemanticPass(entry, report);
      report.notes = scoreNotes(report);
      await writeFile(join(caseDir, "case-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      reports.push(report);
    } catch (error) {
      const report: BenchmarkCaseReport = {
        status: "error",
        id: entry.id,
        category: entry.category,
        expectedFit: entry.expectedFit,
        query: entry.query,
        startSeconds: entry.startSeconds ?? 0,
        clipSeconds: entry.clipSeconds ?? config.clipSeconds,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        appNames: [],
        views: [],
        interactionSegments: [],
        likelyFlow: [],
        likelyCapabilities: [],
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
      report.notes = scoreNotes(report);
      await writeFile(join(caseDir, "case-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      reports.push(report);
    }
  }

  const aggregateReport = buildAggregateReport(config, reports);
  const gateReport = evaluateBenchmarkGate(entries, aggregateReport, config.gateThresholds);
  if (gateReport.enabled) aggregateReport.gate = gateReport;
  const aggregatePath = join(outputRoot, "benchmark.report.json");
  const markdownPath = join(outputRoot, "benchmark.report.md");
  await writeFile(aggregatePath, `${JSON.stringify(aggregateReport, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(aggregateReport), "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        outputRoot,
        aggregatePath,
        markdownPath,
        caseCount: reports.length,
        successCount: aggregateReport.successCount,
        failureCount: aggregateReport.failureCount,
        gate: aggregateReport.gate,
      },
      null,
      2,
    )}\n`,
  );

  if (gateReport.enabled && !gateReport.passed) {
    const failures = gateReport.checks.filter((check) => !check.passed);
    process.stderr.write(
      `Benchmark gate failed: ${failures
        .map((check) => `${check.name} actual ${check.actual} ${check.comparison} threshold ${check.threshold}`)
        .join("; ")}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
