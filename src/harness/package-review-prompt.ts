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
  const bundle = await intakeBundle(input);
  const ocrPreview = await loadOcrPreview(bundle.artifacts["storyboard.ocr.json"]);
  const summaryPreview = await loadSummaryPreview(bundle.artifacts["storyboard.summary.json"]);
  return {
    bundle: {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
    },
    prompt: buildPrompt(input, {
      ...bundle,
      ...(ocrPreview.length > 0 ? { ocrPreview } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
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

export { PackageReviewPromptRequestSchema };
