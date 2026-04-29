import { readFile } from "node:fs/promises";
import { intakeBundle } from "../core/bundle.js";
import {
  PackageReviewPromptRequestSchema,
  type PackageReviewPromptRequest,
} from "../core/schemas.js";

function buildPrompt(input: PackageReviewPromptRequest, bundle: Awaited<ReturnType<typeof intakeBundle>>) {
  const lines = [
    "Review this video run as an evidence-backed artifact bundle.",
    "",
    "Bundle summary:",
    `- Root: ${bundle.rootDir ?? "n/a"}`,
    `- Video: ${bundle.videoPath ?? "n/a"}`,
    `- Overall status: ${bundle.overallStatus}`,
  ];

  if (bundle.reportStatuses.length > 0) {
    lines.push("- Reports:");
    for (const report of bundle.reportStatuses) {
      lines.push(`  - ${report.name}: ${report.status}`);
    }
  }

  const nextArtifact = chooseNextArtifact(bundle);
  if (nextArtifact) {
    lines.push(`- Suggested next artifact: ${nextArtifact.name} (${nextArtifact.path})`);
  }

  if (bundle.videoProbe) {
    lines.push("- Video probe:");
    lines.push(`  - Duration: ${bundle.videoProbe.durationSeconds ?? "unknown"}s`);
    lines.push(
      `  - Resolution: ${bundle.videoProbe.width ?? "?"}x${bundle.videoProbe.height ?? "?"}`,
    );
    lines.push(`  - Codec: ${bundle.videoProbe.codec ?? "unknown"}`);
  }

  const ocrPreview = (bundle as typeof bundle & { ocrPreview?: string[] }).ocrPreview;
  if (ocrPreview && ocrPreview.length > 0) {
    lines.push("- Extracted text preview:");
    for (const line of ocrPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const qualityGatePreview = (bundle as typeof bundle & { qualityGatePreview?: string[] }).qualityGatePreview;
  if (qualityGatePreview && qualityGatePreview.length > 0) {
    lines.push("- Quality gate failures/warnings:");
    for (const line of qualityGatePreview) {
      lines.push(`  - ${line}`);
    }
  }

  const visualDiffPreview = (bundle as typeof bundle & { visualDiffPreview?: string[] }).visualDiffPreview;
  if (visualDiffPreview && visualDiffPreview.length > 0) {
    lines.push("- Visual diff summary:");
    for (const line of visualDiffPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const screenshotPreview = (bundle as typeof bundle & { screenshotPreview?: string[] }).screenshotPreview;
  if (screenshotPreview && screenshotPreview.length > 0) {
    lines.push("- Screenshot evidence:");
    for (const line of screenshotPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const captionRiskPreview = (bundle as typeof bundle & { captionRiskPreview?: string[] }).captionRiskPreview;
  if (captionRiskPreview && captionRiskPreview.length > 0) {
    lines.push("- Caption risk:");
    for (const line of captionRiskPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const layoutSafetyPreview = (bundle as typeof bundle & { layoutSafetyPreview?: string[] }).layoutSafetyPreview;
  if (layoutSafetyPreview && layoutSafetyPreview.length > 0) {
    lines.push("- Layout safety:");
    for (const line of layoutSafetyPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const summaryPreview = (bundle as typeof bundle & {
    summaryPreview?: {
      appNames: string[];
      views: string[];
      flow: string[];
      claims: string[];
      openQuestions: string[];
    };
  }).summaryPreview;
  if (summaryPreview && (summaryPreview.appNames.length || summaryPreview.views.length || summaryPreview.claims.length)) {
    lines.push("- Inferred summary:");
    for (const appName of summaryPreview.appNames) {
      lines.push(`  - app: ${appName}`);
    }
    for (const view of summaryPreview.views) {
      lines.push(`  - view: ${view}`);
    }
    for (const flow of summaryPreview.flow) {
      lines.push(`  - flow: ${flow}`);
    }
    for (const claim of summaryPreview.claims) {
      lines.push(`  - capability: ${claim}`);
    }
    if (summaryPreview.openQuestions.length > 0) {
      lines.push("- Open questions:");
      for (const question of summaryPreview.openQuestions) {
        lines.push(`  - ${question}`);
      }
    }
  }

  const timelinePreview = (bundle as typeof bundle & { timelinePreview?: string[] }).timelinePreview;
  if (timelinePreview && timelinePreview.length > 0) {
    lines.push("- Timeline evidence preview:");
    for (const line of timelinePreview) {
      lines.push(`  - ${line}`);
    }
  }

  const shotPreview = (bundle as typeof bundle & { shotPreview?: string[] }).shotPreview;
  if (shotPreview && shotPreview.length > 0) {
    lines.push("- Shot structure preview:");
    for (const line of shotPreview) {
      lines.push(`  - ${line}`);
    }
  }

  const segmentPreview = (bundle as typeof bundle & { segmentPreview?: string[] }).segmentPreview;
  if (segmentPreview && segmentPreview.length > 0) {
    lines.push("- Segment evidence preview:");
    for (const line of segmentPreview) {
      lines.push(`  - ${line}`);
    }
  }

  lines.push("- Review focus:");
  for (const focus of [...bundle.recommendedFocus, ...input.focus]) {
    lines.push(`  - ${focus}`);
  }

  if (input.specPath) {
    lines.push(`- Reference spec/doc: ${input.specPath}`);
  }

  lines.push("");
  lines.push("Answer with:");
  lines.push("1. critical issues");
  lines.push("2. warnings or polish issues");
  lines.push("3. first artifact to inspect next, using the suggested artifact when it matches the evidence");
  lines.push("4. clear pass / warn / fail judgment");

  return lines.join("\n");
}

export async function packageReviewPrompt(input: PackageReviewPromptRequest) {
  const normalized = PackageReviewPromptRequestSchema.parse(input);
  const bundle = await intakeBundle(normalized);
  const ocrPreview = await loadOcrPreview(bundle.artifacts["storyboard.ocr.json"]);
  const summaryPreview = await loadSummaryPreview(bundle.artifacts["storyboard.summary.json"]);
  const timelinePreview = await loadTimelinePreview(bundle.artifacts["timeline.evidence.json"]);
  const shotPreview = await loadShotPreview(bundle.artifacts["video.shots.json"]);
  const segmentPreview = await loadSegmentPreview(bundle.artifacts["segment.evidence.json"]);
  const qualityGatePreview = await loadQualityGatePreview(bundle.artifacts["quality-gates.json"]);
  const visualDiffPreview = await loadVisualDiffPreview([
    bundle.artifacts["demo-visual-review.diff.json"],
    bundle.artifacts["golden-frame.diff.json"],
  ]);
  const screenshotPreview = await loadScreenshotPreview(
    bundle.artifacts["demo-capture-evidence.json"],
    bundle.artifacts["storyboard.manifest.json"],
  );
  const captionRiskPreview = await loadCaptionRiskPreview(
    bundle.artifacts["caption-artifact.json"],
    bundle.artifacts["quality-gates.json"],
  );
  const layoutSafetyPreview = await loadLayoutSafetyPreview(bundle.artifacts["layout-safety.report.json"]);
  return {
    bundle: {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
      ...(timelinePreview.length > 0 ? { timelinePreview } : {}),
      ...(shotPreview.length > 0 ? { shotPreview } : {}),
      ...(segmentPreview.length > 0 ? { segmentPreview } : {}),
      ...(qualityGatePreview.length > 0 ? { qualityGatePreview } : {}),
      ...(visualDiffPreview.length > 0 ? { visualDiffPreview } : {}),
      ...(screenshotPreview.length > 0 ? { screenshotPreview } : {}),
      ...(captionRiskPreview.length > 0 ? { captionRiskPreview } : {}),
      ...(layoutSafetyPreview.length > 0 ? { layoutSafetyPreview } : {}),
    },
    prompt: buildPrompt(normalized, {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
      ...(timelinePreview.length > 0 ? { timelinePreview } : {}),
      ...(shotPreview.length > 0 ? { shotPreview } : {}),
      ...(segmentPreview.length > 0 ? { segmentPreview } : {}),
      ...(qualityGatePreview.length > 0 ? { qualityGatePreview } : {}),
      ...(visualDiffPreview.length > 0 ? { visualDiffPreview } : {}),
      ...(screenshotPreview.length > 0 ? { screenshotPreview } : {}),
      ...(captionRiskPreview.length > 0 ? { captionRiskPreview } : {}),
      ...(layoutSafetyPreview.length > 0 ? { layoutSafetyPreview } : {}),
    }),
  };
}

function chooseNextArtifact(bundle: Awaited<ReturnType<typeof intakeBundle>>): { name: string; path: string } | null {
  const priority = [
    "quality-gates.json",
    "layout-safety.report.json",
    "demo-visual-review.diff.json",
    "golden-frame.diff.json",
    "caption-artifact.json",
    "segment.evidence.json",
    "timeline.evidence.json",
    "storyboard.ocr.json",
    "contact-sheet.metadata.json",
    "storyboard.manifest.json",
    "analyzer.report.json",
  ];
  for (const name of priority) {
    const status = bundle.reportStatuses.find((entry) => entry.name === name)?.status;
    if ((status === "fail" || status === "warn") && bundle.artifacts[name]) {
      return { name, path: bundle.artifacts[name]! };
    }
  }
  for (const name of priority) {
    if (bundle.artifacts[name]) return { name, path: bundle.artifacts[name]! };
  }
  return null;
}

async function loadOcrPreview(ocrPath: string | undefined): Promise<string[]> {
  if (!ocrPath) return [];
  try {
    const raw = await readFile(ocrPath, "utf8");
    const parsed = JSON.parse(raw) as {
      summary?: { uniqueLines?: string[] };
    };
    return (parsed.summary?.uniqueLines ?? []).filter(Boolean).slice(0, 10);
  } catch {
    return [];
  }
}

async function loadSummaryPreview(
  summaryPath: string | undefined,
): Promise<{
  appNames: string[];
  views: string[];
  flow: string[];
  claims: string[];
  openQuestions: string[];
} | null> {
  if (!summaryPath) return null;
  try {
    const raw = await readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw) as {
      appNames?: string[];
      views?: string[];
      likelyFlow?: string[];
      likelyCapabilities?: Array<{ claim?: string }>;
      openQuestions?: string[];
    };
    return {
      appNames: (parsed.appNames ?? []).slice(0, 3),
      views: (parsed.views ?? []).slice(0, 5),
      flow: (parsed.likelyFlow ?? []).slice(0, 6),
      claims: (parsed.likelyCapabilities ?? [])
        .map((entry) => entry.claim)
        .filter((value): value is string => typeof value === "string")
        .slice(0, 5),
      openQuestions: (parsed.openQuestions ?? []).filter(Boolean).slice(0, 4),
    };
  } catch {
    return null;
  }
}

async function loadTimelinePreview(timelinePath: string | undefined): Promise<string[]> {
  if (!timelinePath) return [];
  try {
    const raw = await readFile(timelinePath, "utf8");
    const parsed = JSON.parse(raw) as {
      evidence?: Array<{
        kind?: string;
        startSeconds?: number;
        endSeconds?: number;
        text?: string;
        action?: string;
      }>;
    };
    return (parsed.evidence ?? [])
      .slice(0, 8)
      .map((item) => {
        const label = item.text ?? item.action ?? "timeline item";
        const start = typeof item.startSeconds === "number" ? item.startSeconds.toFixed(2) : "?";
        const end = typeof item.endSeconds === "number" ? item.endSeconds.toFixed(2) : "?";
        return `${item.kind ?? "evidence"} ${start}-${end}s: ${label}`;
      });
  } catch {
    return [];
  }
}

async function loadShotPreview(shotsPath: string | undefined): Promise<string[]> {
  if (!shotsPath) return [];
  try {
    const raw = await readFile(shotsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      shots?: Array<{
        index?: number;
        startSeconds?: number;
        endSeconds?: number;
        durationSeconds?: number;
        representativeFramePath?: string;
      }>;
    };
    return (parsed.shots ?? []).slice(0, 8).map((shot, index) => {
      const shotIndex = typeof shot.index === "number" ? shot.index : index + 1;
      const start = typeof shot.startSeconds === "number" ? shot.startSeconds.toFixed(2) : "?";
      const end = typeof shot.endSeconds === "number" ? shot.endSeconds.toFixed(2) : "?";
      const duration = typeof shot.durationSeconds === "number" ? `${shot.durationSeconds.toFixed(2)}s` : "unknown";
      const frame = shot.representativeFramePath ? ` frame=${shot.representativeFramePath}` : "";
      return `shot ${shotIndex} ${start}-${end}s (${duration})${frame}`;
    });
  } catch {
    return [];
  }
}

async function loadSegmentPreview(segmentPath: string | undefined): Promise<string[]> {
  if (!segmentPath) return [];
  try {
    const raw = await readFile(segmentPath, "utf8");
    const parsed = JSON.parse(raw) as {
      segments?: Array<{
        index?: number;
        startSeconds?: number;
        endSeconds?: number;
        evidenceStatus?: string;
        evidenceCounts?: {
          storyboardFrames?: number;
          timelineItems?: number;
          transitions?: number;
        };
        textEvidence?: Array<{ text?: string }>;
      }>;
    };
    return (parsed.segments ?? []).slice(0, 8).map((segment, index) => {
      const segmentIndex = typeof segment.index === "number" ? segment.index : index + 1;
      const start = typeof segment.startSeconds === "number" ? segment.startSeconds.toFixed(2) : "?";
      const end = typeof segment.endSeconds === "number" ? segment.endSeconds.toFixed(2) : "?";
      const status = segment.evidenceStatus ?? "unknown";
      const counts = segment.evidenceCounts ?? {};
      const text = segment.textEvidence?.map((item) => item.text).filter(Boolean).slice(0, 2).join(" | ");
      const textSuffix = text ? ` text=${text}` : "";
      return `segment ${segmentIndex} ${start}-${end}s status=${status} frames=${counts.storyboardFrames ?? 0} timeline=${counts.timelineItems ?? 0} transitions=${counts.transitions ?? 0}${textSuffix}`;
    });
  } catch {
    return [];
  }
}

async function loadQualityGatePreview(path: string | undefined): Promise<string[]> {
  if (!path) return [];
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      gates?: Array<{
        id?: string;
        status?: string;
        message?: string;
        recommendation?: string;
        evidence?: Array<{ timestampSeconds?: number; note?: string }>;
      }>;
    };
    return (parsed.gates ?? [])
      .filter((gate) => gate.status === "fail" || gate.status === "warn")
      .slice(0, 8)
      .map((gate) => {
        const evidence = gate.evidence?.[0];
        const timestamp =
          typeof evidence?.timestampSeconds === "number"
            ? ` @ ${evidence.timestampSeconds.toFixed(2)}s`
            : "";
        const detail = gate.message ?? evidence?.note ?? gate.recommendation ?? "review gate evidence";
        return `${gate.id ?? "gate"}: ${gate.status}${timestamp} - ${detail}`;
      });
  } catch {
    return [];
  }
}

async function loadVisualDiffPreview(paths: Array<string | undefined>): Promise<string[]> {
  const lines: string[] = [];
  for (const path of paths.filter((value): value is string => Boolean(value))) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as {
        overallStatus?: string;
        summary?: {
          comparedFrameCount?: number;
          averageMismatchPercent?: number;
          maxMismatchPercent?: number;
        };
        diagnostics?: Array<{ code?: string; message?: string; severity?: string }>;
      };
      const summary = parsed.summary ?? {};
      const max =
        typeof summary.maxMismatchPercent === "number"
          ? `${(summary.maxMismatchPercent * 100).toFixed(2)}% max mismatch`
          : "max mismatch unknown";
      const average =
        typeof summary.averageMismatchPercent === "number"
          ? `${(summary.averageMismatchPercent * 100).toFixed(2)}% average`
          : "average unknown";
      lines.push(
        `${path}: ${parsed.overallStatus ?? "unknown"}; ${summary.comparedFrameCount ?? 0} frame(s); ${max}; ${average}`,
      );
      for (const diagnostic of (parsed.diagnostics ?? []).slice(0, 3)) {
        lines.push(
          `${path}: ${diagnostic.severity ?? "warning"} ${diagnostic.code ?? "diagnostic"} - ${diagnostic.message ?? "review diagnostic"}`,
        );
      }
    } catch {
      continue;
    }
  }
  return lines.slice(0, 10);
}

async function loadScreenshotPreview(
  capturePath: string | undefined,
  storyboardPath: string | undefined,
): Promise<string[]> {
  const lines: string[] = [];
  if (capturePath) {
    try {
      const raw = await readFile(capturePath, "utf8");
      const parsed = JSON.parse(raw) as {
        screenshotEvidence?: Array<{
          framePath?: string;
          timestampSeconds?: number;
          note?: string;
        }>;
        summary?: { screenshotCount?: number; status?: string };
      };
      lines.push(
        `${capturePath}: ${parsed.summary?.status ?? "present"}; ${parsed.summary?.screenshotCount ?? parsed.screenshotEvidence?.length ?? 0} screenshot(s)`,
      );
      for (const evidence of (parsed.screenshotEvidence ?? []).slice(0, 5)) {
        const timestamp =
          typeof evidence.timestampSeconds === "number"
            ? ` @ ${evidence.timestampSeconds.toFixed(2)}s`
            : "";
        lines.push(`${evidence.framePath ?? "screenshot"}${timestamp}${evidence.note ? ` - ${evidence.note}` : ""}`);
      }
    } catch {
      // Fall back to storyboard frames below.
    }
  }
  if (storyboardPath && lines.length < 2) {
    try {
      const raw = await readFile(storyboardPath, "utf8");
      const parsed = JSON.parse(raw) as {
        frames?: Array<{ imagePath?: string; path?: string; timestampSeconds?: number }>;
      };
      for (const frame of (parsed.frames ?? []).slice(0, 5)) {
        const timestamp =
          typeof frame.timestampSeconds === "number"
            ? ` @ ${frame.timestampSeconds.toFixed(2)}s`
            : "";
        lines.push(`${frame.imagePath ?? frame.path ?? "storyboard frame"}${timestamp}`);
      }
    } catch {
      return lines;
    }
  }
  return lines.slice(0, 8);
}

async function loadCaptionRiskPreview(
  captionPath: string | undefined,
  qualityGatePath: string | undefined,
): Promise<string[]> {
  const lines: string[] = [];
  if (captionPath) {
    try {
      const raw = await readFile(captionPath, "utf8");
      const parsed = JSON.parse(raw) as {
        summary?: {
          status?: string;
          cueCount?: number;
          readableCueShare?: number;
          synchronizedCueShare?: number;
        };
        diagnostics?: Array<{ code?: string; message?: string; severity?: string }>;
      };
      const summary = parsed.summary ?? {};
      const readable =
        typeof summary.readableCueShare === "number"
          ? ` readable=${(summary.readableCueShare * 100).toFixed(0)}%`
          : "";
      const synced =
        typeof summary.synchronizedCueShare === "number"
          ? ` synced=${(summary.synchronizedCueShare * 100).toFixed(0)}%`
          : "";
      lines.push(
        `${captionPath}: ${summary.status ?? "present"}; cues=${summary.cueCount ?? "unknown"}${readable}${synced}`,
      );
      for (const diagnostic of (parsed.diagnostics ?? []).slice(0, 3)) {
        lines.push(
          `${diagnostic.severity ?? "warning"} ${diagnostic.code ?? "caption-diagnostic"} - ${diagnostic.message ?? "review caption diagnostic"}`,
        );
      }
    } catch {
      // Quality gates may still contain caption-specific risk.
    }
  }
  if (qualityGatePath) {
    for (const line of await loadQualityGatePreview(qualityGatePath)) {
      if (line.toLowerCase().includes("caption")) lines.push(line);
    }
  }
  return lines.slice(0, 8);
}

async function loadLayoutSafetyPreview(path: string | undefined): Promise<string[]> {
  if (!path) return [];
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      status?: string;
      overallStatus?: string;
      issues?: Array<{ code?: string; message?: string; severity?: string }>;
      diagnostics?: Array<{ code?: string; message?: string; severity?: string }>;
      metrics?: Record<string, unknown>;
    };
    const lines = [`${path}: ${parsed.status ?? parsed.overallStatus ?? "present"}`];
    for (const issue of [...(parsed.issues ?? []), ...(parsed.diagnostics ?? [])].slice(0, 6)) {
      lines.push(
        `${issue.severity ?? "warning"} ${issue.code ?? "layout-issue"} - ${issue.message ?? "review layout evidence"}`,
      );
    }
    return lines;
  } catch {
    return [];
  }
}

export { PackageReviewPromptRequestSchema };
