#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

interface BenchmarkEntry {
  id: string;
  category: string;
  query: string;
  expectedFit: "high" | "medium" | "low";
  startSeconds?: number;
  clipSeconds?: number;
}

interface ResolvedVideo {
  id: string;
  url: string;
  title: string;
  channel?: string;
  durationSeconds?: number;
}

interface BenchmarkConfig {
  manifestPath: string;
  outputRoot: string;
  limit?: number;
  frameCount: number;
  clipSeconds: number;
  changeThreshold: number;
  minConfidence: number;
}

interface BenchmarkCaseReport {
  status: "ok" | "error";
  id: string;
  category: string;
  expectedFit: "high" | "medium" | "low";
  query: string;
  title?: string;
  url?: string;
  channel?: string;
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
  interactionSegments: Array<{
    summary: string;
    transitionKinds: string[];
    evidence: string[];
  }>;
  likelyFlow: string[];
  likelyCapabilities: string[];
  notes: string[];
  error?: string;
}

interface BenchmarkAggregateReport {
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
    withInteractionSegments: number;
    withLikelyFlow: number;
    withCapabilities: number;
  };
  fitBreakdown: Record<
    BenchmarkEntry["expectedFit"],
    {
      total: number;
      ok: number;
      withAppNames: number;
      withInteractionSegments: number;
      withLikelyFlow: number;
    }
  >;
  reports: BenchmarkCaseReport[];
}

function parseArgs(argv: string[]) {
  const manifestPath =
    argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length) ??
    "benchmarks/youtube-diverse-queries.json";
  const outputRoot =
    argv.find((arg) => arg.startsWith("--output-root="))?.slice("--output-root=".length) ??
    "/home/calvin/tmp/video-evaluator-youtube-benchmark";
  const limitArg = argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
  const frameCountArg = argv.find((arg) => arg.startsWith("--frame-count="))?.slice("--frame-count=".length);
  const clipSecondsArg = argv.find((arg) => arg.startsWith("--clip-seconds="))?.slice("--clip-seconds=".length);
  const changeThresholdArg = argv
    .find((arg) => arg.startsWith("--change-threshold="))
    ?.slice("--change-threshold=".length);
  const minConfidenceArg = argv
    .find((arg) => arg.startsWith("--min-confidence="))
    ?.slice("--min-confidence=".length);
  return {
    manifestPath: resolve(manifestPath),
    outputRoot: resolve(outputRoot),
    limit: limitArg ? Number(limitArg) : undefined,
    frameCount: frameCountArg ? Number(frameCountArg) : 8,
    clipSeconds: clipSecondsArg ? Number(clipSecondsArg) : 75,
    changeThreshold: changeThresholdArg ? Number(changeThresholdArg) : 0.08,
    minConfidence: minConfidenceArg ? Number(minConfidenceArg) : 45,
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

async function resolveVideo(runtime: YtDlpRuntime, query: string): Promise<ResolvedVideo> {
  const { stdout } = await runYtDlp(runtime, ["--flat-playlist", "-J", `ytsearch1:${query}`], {
    maxBuffer: 1024 * 1024 * 8,
  });
  const parsed = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> };
  const entry = parsed.entries?.[0];
  if (!entry) throw new Error(`No video found for query: ${query}`);
  const id = String(entry.id);
  return {
    id,
    url:
      typeof entry.webpage_url === "string" && entry.webpage_url.length > 0
        ? entry.webpage_url
        : `https://www.youtube.com/watch?v=${id}`,
    title: String(entry.title),
    channel:
      typeof entry.channel === "string"
        ? entry.channel
        : typeof entry.uploader === "string"
          ? entry.uploader
          : undefined,
    durationSeconds:
      typeof entry.duration === "number"
        ? entry.duration
        : entry.duration
          ? Number(entry.duration)
          : undefined,
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
  if (report.expectedFit === "low" && report.likelyFlow.length > 0) {
    notes.push("Low-fit sample still produced structured flow output.");
  }
  return notes;
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
  lines.push(`- Interaction segments recovered: ${aggregate.metrics.withInteractionSegments}/${aggregate.successCount}`);
  lines.push(`- Likely flow recovered: ${aggregate.metrics.withLikelyFlow}/${aggregate.successCount}`);
  lines.push("");
  lines.push("## Fit Breakdown");
  lines.push("");
  for (const [fit, stats] of Object.entries(aggregate.fitBreakdown)) {
    lines.push(
      `- ${fit}: ${stats.ok}/${stats.total} ok, app names ${stats.withAppNames}, segments ${stats.withInteractionSegments}, flow ${stats.withLikelyFlow}`,
    );
  }
  lines.push("");
  for (const report of aggregate.reports) {
    lines.push(`## ${report.id}`);
    lines.push(`- Status: ${report.status}`);
    lines.push(`- Category: ${report.category}`);
    lines.push(`- Expected fit: ${report.expectedFit}`);
    lines.push(`- Title: ${report.title ?? "unresolved"}`);
    lines.push(`- URL: ${report.url ?? "unresolved"}`);
    if (report.channel) lines.push(`- Channel: ${report.channel}`);
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

function buildAggregateReport(config: BenchmarkConfig, reports: BenchmarkCaseReport[]): BenchmarkAggregateReport {
  const okReports = reports.filter((report) => report.status === "ok");
  const fitBreakdown: BenchmarkAggregateReport["fitBreakdown"] = {
    high: { total: 0, ok: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0 },
    medium: { total: 0, ok: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0 },
    low: { total: 0, ok: 0, withAppNames: 0, withInteractionSegments: 0, withLikelyFlow: 0 },
  };

  for (const report of reports) {
    const bucket = fitBreakdown[report.expectedFit];
    bucket.total += 1;
    if (report.status !== "ok") continue;
    bucket.ok += 1;
    if (report.appNames.length > 0) bucket.withAppNames += 1;
    if (report.interactionSegments.length > 0) bucket.withInteractionSegments += 1;
    if (report.likelyFlow.length > 0) bucket.withLikelyFlow += 1;
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
      withInteractionSegments: okReports.filter((report) => report.interactionSegments.length > 0).length,
      withLikelyFlow: okReports.filter((report) => report.likelyFlow.length > 0).length,
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
      const resolved = await resolveVideo(ytDlpRuntime, entry.query);
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
        interactionSegments: summary.manifest.interactionSegments.map((segment) => ({
          summary: segment.summary,
          transitionKinds: segment.transitionKinds,
          evidence: segment.evidence,
        })),
        likelyFlow: summary.manifest.likelyFlow,
        likelyCapabilities: summary.manifest.likelyCapabilities.map((claim) => claim.claim),
        notes: [],
      };
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
      },
      null,
      2,
    )}\n`,
  );
}

await run();
