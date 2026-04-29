import { access, constants, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoIntakeRequest } from "./schemas.js";
import { buildTimelineEvidence, collectTimelineSourceArtifacts } from "./timeline-evidence.js";

const execFileAsync = promisify(execFile);

const VIDEO_CANDIDATES = ["output.mp4", "video.mp4", "video.webm"];
const REPORT_CANDIDATES = [
  "analyzer.report.json",
  "media-probe.json",
  "quality-gates.json",
  "caption-artifact.json",
  "layout-safety.report.json",
  "video-technical.report.json",
  "contact-sheet.metadata.json",
  "golden-frame.diff.json",
  "demo-visual-review.diff.json",
  "demo-capture-evidence.json",
  "quality.json",
  "verification.json",
  "validate.json",
  "score.json",
  "publish.json",
  "video.shots.json",
  "segment.evidence.json",
  "storyboard.manifest.json",
  "storyboard.ocr.json",
  "storyboard.summary.json",
  "storyboard.transitions.json",
  "timeline.evidence.json",
  "timestamps.json",
  "metadata.json",
  "environment.json",
  "events.json",
  "subtitles.vtt",
  "subtitles.srt",
  "trace.zip",
] as const;

const STORYBOARD_SUBDIR_CANDIDATES = [
  "storyboard.manifest.json",
  "storyboard.ocr.json",
  "storyboard.summary.json",
  "storyboard.transitions.json",
] as const;

export interface BundleArtifactMap {
  rootDir: string | null;
  videoPath: string | null;
  artifacts: Record<string, string>;
  reportStatuses: Array<{ name: string; status: string; note?: string }>;
  overallStatus: "pass" | "warn" | "fail" | "unknown";
  recommendedFocus: string[];
  videoProbe?: {
    durationSeconds?: number;
    width?: number;
    height?: number;
    sizeBytes?: number;
    codec?: string;
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function maybeReadJson(path: string): Promise<unknown | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deriveReportStatus(name: string, data: unknown): { status: string; note?: string } {
  if (!data || typeof data !== "object") {
    return { status: "present" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.status === "string") {
    return { status: record.status };
  }
  if (typeof record.overallStatus === "string") {
    return { status: record.overallStatus };
  }
  if (
    record.summary &&
    typeof record.summary === "object" &&
    typeof (record.summary as { status?: unknown }).status === "string"
  ) {
    return { status: (record.summary as { status: string }).status };
  }
  if (typeof record.passed === "boolean") {
    return { status: record.passed ? "pass" : "fail" };
  }
  if (typeof record.hasFailures === "boolean") {
    return { status: record.hasFailures ? "fail" : "pass" };
  }
  if (name === "publish.json" && Array.isArray(record.checklist)) {
    return { status: "present", note: "publish metadata found" };
  }
  return { status: "present" };
}

function collapseOverallStatus(
  statuses: Array<{ name: string; status: string }>,
): "pass" | "warn" | "fail" | "unknown" {
  if (statuses.length === 0) return "unknown";
  if (statuses.some((entry) => entry.status === "fail" || entry.status === "error")) return "fail";
  if (statuses.some((entry) => entry.status === "warn")) return "warn";
  if (statuses.some((entry) => entry.status === "pass")) return "pass";
  return "unknown";
}

function deriveRecommendedFocus(
  statuses: Array<{ name: string; status: string }>,
  artifacts: Record<string, string>,
): string[] {
  const focus = new Set<string>();
  for (const entry of statuses) {
    if (entry.status === "fail" || entry.status === "warn") {
      focus.add(entry.name);
    }
  }
  if (artifacts["events.json"]) focus.add("timeline accuracy");
  if (artifacts["analyzer.report.json"]) focus.add("analyzer report");
  if (artifacts["media-probe.json"]) focus.add("media probe");
  if (artifacts["quality-gates.json"]) focus.add("quality gates");
  if (artifacts["caption-artifact.json"]) focus.add("caption artifacts");
  if (artifacts["layout-safety.report.json"]) focus.add("layout safety");
  if (artifacts["video-technical.report.json"]) focus.add("technical video review");
  if (artifacts["contact-sheet.metadata.json"]) focus.add("contact sheet");
  if (artifacts["golden-frame.diff.json"] || artifacts["demo-visual-review.diff.json"]) {
    focus.add("visual diff");
  }
  if (artifacts["demo-capture-evidence.json"]) focus.add("screenshot evidence");
  if (artifacts["timestamps.json"]) focus.add("audio timeline");
  if (artifacts["timeline.evidence.json"]) focus.add("timeline evidence");
  if (artifacts["video.shots.json"]) focus.add("video shot structure");
  if (artifacts["segment.evidence.json"]) focus.add("segment evidence");
  if (artifacts["subtitles.vtt"]) focus.add("caption readability");
  if (artifacts["trace.zip"]) focus.add("failure trace");
  if (artifacts["storyboard.manifest.json"]) focus.add("storyboard evidence");
  if (artifacts["storyboard.ocr.json"]) focus.add("extracted UI text");
  if (artifacts["storyboard.summary.json"]) focus.add("inferred product summary");
  if (artifacts["storyboard.transitions.json"]) focus.add("frame-to-frame changes");
  if (focus.size === 0 && (artifacts["output.mp4"] || artifacts["video.mp4"])) {
    focus.add("overall pacing");
    focus.add("visual clarity");
  }
  return [...focus];
}

async function resolveFromLatestPointer(root: string): Promise<string> {
  const latestJson = join(root, "latest.json");
  const latestTxt = join(root, "LATEST.txt");
  const latest = await maybeReadJson(latestJson);
  if (latest && typeof latest === "object" && typeof (latest as { outputDir?: unknown }).outputDir === "string") {
    return resolve((latest as { outputDir: string }).outputDir);
  }
  if (await pathExists(latestTxt)) {
    const raw = await readFile(latestTxt, "utf8");
    const candidate = raw.trim();
    if (candidate) return resolve(root, candidate);
  }
  return resolve(root);
}

async function findVideoCandidate(rootDir: string): Promise<string | null> {
  for (const candidate of VIDEO_CANDIDATES) {
    const path = join(rootDir, candidate);
    if (await pathExists(path)) return path;
  }
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const mp4 = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"));
    return mp4 ? join(rootDir, mp4.name) : null;
  } catch {
    return null;
  }
}

async function findArtifactVideoPath(
  rootDir: string,
  artifacts: Record<string, string>,
): Promise<string | null> {
  for (const name of ["video.shots.json", "storyboard.manifest.json", "storyboard.ocr.json", "storyboard.summary.json"]) {
    const path = artifacts[name];
    if (!path) continue;
    const data = await maybeReadJson(path);
    if (!data || typeof data !== "object") continue;
    const artifactVideoPath = (data as { videoPath?: unknown }).videoPath;
    if (typeof artifactVideoPath !== "string" || !artifactVideoPath) continue;
    const resolved = resolve(rootDir, artifactVideoPath);
    if (await pathExists(resolved)) return resolved;
  }
  return null;
}

async function probeVideo(path: string): Promise<BundleArtifactMap["videoProbe"] | undefined> {
  try {
    const fileStat = await stat(path);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    const videoStream =
      parsed.streams?.find((stream) => stream.codec_type === "video") ??
      parsed.streams?.[0];
    const durationRaw = parsed.format?.duration;
    return {
      durationSeconds:
        typeof durationRaw === "string" ? Number(durationRaw) : undefined,
      width: typeof videoStream?.width === "number" ? videoStream.width : undefined,
      height: typeof videoStream?.height === "number" ? videoStream.height : undefined,
      codec: typeof videoStream?.codec_name === "string" ? videoStream.codec_name : undefined,
      sizeBytes: fileStat.size,
    };
  } catch {
    return undefined;
  }
}

export async function intakeBundle(request: VideoIntakeRequest): Promise<BundleArtifactMap> {
  let rootDir: string | null = null;
  if (request.outputDir) {
    rootDir = resolve(request.outputDir);
  } else if (request.latestPointerRoot) {
    rootDir = await resolveFromLatestPointer(resolve(request.latestPointerRoot));
  }

  let videoPath = request.videoPath ? resolve(request.videoPath) : null;
  if (!rootDir && videoPath) {
    rootDir = dirname(videoPath);
  }

  const artifacts: Record<string, string> = {};
  if (rootDir) {
    for (const name of REPORT_CANDIDATES) {
      const path = join(rootDir, name);
      if (await pathExists(path)) artifacts[name] = path;
    }
    for (const name of STORYBOARD_SUBDIR_CANDIDATES) {
      const path = join(rootDir, "segment-storyboard", name);
      if (!artifacts[name] && await pathExists(path)) artifacts[name] = path;
    }
    for (const name of STORYBOARD_SUBDIR_CANDIDATES) {
      const path = join(rootDir, "storyboard", name);
      if (!artifacts[name] && await pathExists(path)) artifacts[name] = path;
    }
    if (!artifacts["timeline.evidence.json"] && Object.keys(collectTimelineSourceArtifacts(artifacts)).length > 0) {
      const timelinePath = join(rootDir, "timeline.evidence.json");
      const manifest = await buildTimelineEvidence({ rootDir, artifacts, outputPath: timelinePath });
      if (manifest) artifacts["timeline.evidence.json"] = timelinePath;
    }
    if (!videoPath) {
      videoPath = (await findArtifactVideoPath(rootDir, artifacts)) ?? (await findVideoCandidate(rootDir));
    }
  }
  if (videoPath) {
    artifacts["video"] = videoPath;
  }

  const reportStatuses: Array<{ name: string; status: string; note?: string }> = [];
  for (const [name, path] of Object.entries(artifacts)) {
    if (!name.endsWith(".json")) continue;
    const json = await maybeReadJson(path);
    const derived = deriveReportStatus(name, json);
    reportStatuses.push({ name, ...derived });
  }

  const overallStatus = collapseOverallStatus(reportStatuses);
  const recommendedFocus = deriveRecommendedFocus(reportStatuses, artifacts);
  const videoProbe = videoPath ? await probeVideo(videoPath) : undefined;

  return {
    rootDir,
    videoPath,
    artifacts,
    reportStatuses,
    overallStatus,
    recommendedFocus,
    ...(videoProbe ? { videoProbe } : {}),
  };
}

export async function copySkillPack(
  targetDir: string,
  includeAgentRunner: boolean,
  installDependencies: boolean,
): Promise<string[]> {
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../");
  const copied: string[] = [];
  const skillRoot = join(repoRoot, "skills");
  const targetRoot = resolve(targetDir);
  const targetSkillsRoot = join(targetRoot, "skills");
  await mkdir(targetSkillsRoot, { recursive: true });

  const skillEntries = await readdir(skillRoot, { withFileTypes: true });
  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(skillRoot, entry.name);
    const targetSkillDir = join(targetSkillsRoot, entry.name);
    await mkdir(join(targetSkillDir, "examples"), { recursive: true });
    const skillFile = join(sourceDir, "SKILL.md");
    if (await pathExists(skillFile)) {
      await copyFile(skillFile, join(targetSkillDir, "SKILL.md"));
      copied.push(join(targetSkillDir, "SKILL.md"));
    }
    const examplesDir = join(sourceDir, "examples");
    if (await pathExists(examplesDir)) {
      const examples = await readdir(examplesDir, { withFileTypes: true });
      for (const example of examples) {
        if (!example.isFile()) continue;
        const sourcePath = join(examplesDir, example.name);
        const targetPath = join(targetSkillDir, "examples", example.name);
        await copyFile(sourcePath, targetPath);
        copied.push(targetPath);
      }
    }
  }

  const distSource = join(repoRoot, "dist");
  if (!(await pathExists(distSource))) {
    throw new Error("dist/ is missing. Run `npm run build` before `install-skill-pack`.");
  }
  await copyDirRecursive(distSource, join(targetRoot, "dist"), copied);

  const docsSource = join(repoRoot, "docs");
  if (await pathExists(docsSource)) {
    await copyDirRecursive(docsSource, join(targetRoot, "docs"), copied);
  }

  for (const repoDir of ["assets", "benchmarks"]) {
    const sourcePath = join(repoRoot, repoDir);
    if (await pathExists(sourcePath)) {
      await copyDirRecursive(sourcePath, join(targetRoot, repoDir), copied);
    }
  }

  for (const repoFile of ["package.json", "package-lock.json", "README.md", "SUPPORT.md", "LICENSE", "eng.traineddata"]) {
    const sourcePath = join(repoRoot, repoFile);
    if (!(await pathExists(sourcePath))) continue;
    const targetPath = join(targetRoot, repoFile);
    await copyFile(sourcePath, targetPath);
    copied.push(targetPath);
  }

  if (includeAgentRunner) {
    const agentTarget = join(targetRoot, "agent");
    await mkdir(agentTarget, { recursive: true });
    const sourceRunner = join(repoRoot, "agent", "run-tool.mjs");
    const targetRunner = join(agentTarget, "run-tool.mjs");
    await copyFile(sourceRunner, targetRunner);
    copied.push(targetRunner);
  }

  if (installDependencies) {
    await execFileAsync("npm", ["install", "--omit=dev"], {
      cwd: targetRoot,
    });
  }

  return copied;
}

async function copyDirRecursive(sourceDir: string, targetDir: string, copied: string[]): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(sourcePath, targetPath, copied);
      continue;
    }
    if (!entry.isFile()) continue;
    await copyFile(sourcePath, targetPath);
    copied.push(targetPath);
  }
}
