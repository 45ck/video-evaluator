import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { packageReviewPrompt } from "../src/harness/package-review-prompt.js";
import {
  AnalyzerReportSchema,
  CaptionArtifactSchema,
  MediaProbeArtifactSchema,
  QualityGateReportSchema,
} from "../src/contracts/index.js";

const fixtureDir = join(
  process.cwd(),
  "tests",
  "fixtures",
  "canonical-analyzer-bundle",
);

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

test("canonical analyzer fixture artifacts validate against public contracts", async () => {
  assert.equal(
    AnalyzerReportSchema.parse(await readFixture("analyzer.report.json"))
      .schemaVersion,
    "analyzer-report.v1",
  );
  assert.equal(
    MediaProbeArtifactSchema.parse(await readFixture("media-probe.json"))
      .schemaVersion,
    "media-probe.v1",
  );
  assert.equal(
    QualityGateReportSchema.parse(await readFixture("quality-gates.json"))
      .overallStatus,
    "warn",
  );
  assert.equal(
    CaptionArtifactSchema.parse(await readFixture("caption-artifact.json"))
      .summary.cueCount,
    1,
  );
});

test("bundle intake treats canonical analyzer artifacts as first-class evidence", async () => {
  const bundle = await intakeBundle({ outputDir: fixtureDir });

  assert.ok(bundle.artifacts["analyzer.report.json"]);
  assert.ok(bundle.artifacts["media-probe.json"]);
  assert.ok(bundle.artifacts["quality-gates.json"]);
  assert.ok(bundle.artifacts["caption-artifact.json"]);
  assert.equal(bundle.overallStatus, "warn");
  assert.ok(bundle.recommendedFocus.includes("analyzer report"));
  assert.ok(bundle.recommendedFocus.includes("quality gates"));
  assert.ok(bundle.recommendedFocus.includes("caption artifacts"));
});

test("package review prompt references canonical analyzer reports", async () => {
  const result = await packageReviewPrompt({
    outputDir: fixtureDir,
    focus: ["cross-repo compatibility"],
  });

  assert.match(result.prompt, /analyzer\.report\.json: warn/);
  assert.match(result.prompt, /media-probe\.json: present/);
  assert.match(result.prompt, /quality-gates\.json: present/);
  assert.match(result.prompt, /caption-artifact\.json: present/);
  assert.match(result.prompt, /analyzer report/);
  assert.match(result.prompt, /cross-repo compatibility/);
});
