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
  return {
    bundle,
    prompt: buildPrompt(input, bundle),
  };
}

export { PackageReviewPromptRequestSchema };
