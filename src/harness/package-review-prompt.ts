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
  lines.push("3. first artifact to inspect next");
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
  return {
    bundle: {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
      ...(timelinePreview.length > 0 ? { timelinePreview } : {}),
      ...(shotPreview.length > 0 ? { shotPreview } : {}),
      ...(segmentPreview.length > 0 ? { segmentPreview } : {}),
    },
    prompt: buildPrompt(normalized, {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
      ...(timelinePreview.length > 0 ? { timelinePreview } : {}),
      ...(shotPreview.length > 0 ? { shotPreview } : {}),
      ...(segmentPreview.length > 0 ? { segmentPreview } : {}),
    }),
  };
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

export { PackageReviewPromptRequestSchema };
