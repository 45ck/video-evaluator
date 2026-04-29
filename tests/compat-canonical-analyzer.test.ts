import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { packageReviewPrompt } from "../src/harness/package-review-prompt.js";
import { listSkillCatalog } from "../src/harness/skill-catalog.js";
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

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-review-prompt-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  assert.match(result.prompt, /quality-gates\.json: warn/);
  assert.match(result.prompt, /caption-artifact\.json: pass/);
  assert.match(result.prompt, /Suggested next artifact: quality-gates\.json/);
  assert.match(result.prompt, /analyzer report/);
  assert.match(result.prompt, /cross-repo compatibility/);
});

test("package review prompt routes quality, visual, screenshot, caption, and layout evidence", async () => {
  await withTempDir(async (dir) => {
    await writeJson(join(dir, "quality-gates.json"), {
      schemaVersion: "quality-gates.v1",
      createdAt: "2026-04-29T00:00:00.000Z",
      subject: { kind: "video", videoPath: join(dir, "output.mp4") },
      overallStatus: "warn",
      gates: [
        {
          id: "caption-safe-zone",
          status: "warn",
          message: "Caption overlaps the product controls.",
          evidence: [{ timestampSeconds: 2.4, note: "caption overlaps UI" }],
        },
      ],
    });
    await writeJson(join(dir, "demo-visual-review.diff.json"), {
      schemaVersion: "visual-diff.v1",
      createdAt: "2026-04-29T00:00:00.000Z",
      left: { name: "baseline", path: join(dir, "baseline") },
      right: { name: "current", path: join(dir, "current") },
      overallStatus: "fail",
      frames: [],
      summary: {
        comparedFrameCount: 2,
        averageMismatchPercent: 0.03,
        maxMismatchPercent: 0.08,
      },
      diagnostics: [{ code: "dimension-mismatch", message: "Frame sizes differ." }],
    });
    await writeJson(join(dir, "demo-capture-evidence.json"), {
      schemaVersion: "demo-capture-evidence.v1",
      createdAt: "2026-04-29T00:00:00.000Z",
      subject: { kind: "demo-capture", bundleDir: dir },
      screenshotEvidence: [
        { framePath: join(dir, "screens", "001.png"), timestampSeconds: 1.2 },
      ],
      summary: { status: "pass", eventCount: 1, screenshotCount: 1 },
    });
    await writeJson(join(dir, "caption-artifact.json"), {
      schemaVersion: "caption-artifact.v1",
      createdAt: "2026-04-29T00:00:00.000Z",
      subject: { kind: "video", videoPath: join(dir, "output.mp4") },
      trackFormat: "webvtt",
      cues: [],
      summary: { status: "warn", cueCount: 2, readableCueShare: 0.5 },
    });
    await writeJson(join(dir, "layout-safety.report.json"), {
      schemaVersion: "layout-safety-report.v1",
      status: "warn",
      issues: [{ code: "caption-safe-zone-collision", message: "Caption collides." }],
    });
    await writeJson(join(dir, "timeline.evidence.json"), {
      schemaVersion: "timeline-evidence.v1",
      evidence: [
        { kind: "caption", startSeconds: 0, endSeconds: 1, text: "Open settings" },
      ],
    });

    const result = await packageReviewPrompt({ outputDir: dir });

    assert.match(result.prompt, /Suggested next artifact: quality-gates\.json/);
    assert.match(result.prompt, /Quality gate failures\/warnings/);
    assert.match(result.prompt, /caption-safe-zone: warn @ 2\.40s/);
    assert.match(result.prompt, /Visual diff summary/);
    assert.match(result.prompt, /8\.00% max mismatch/);
    assert.match(result.prompt, /Screenshot evidence/);
    assert.match(result.prompt, /screens\/001\.png @ 1\.20s/);
    assert.match(result.prompt, /Caption risk/);
    assert.match(result.prompt, /readable=50%/);
    assert.match(result.prompt, /Layout safety/);
    assert.match(result.prompt, /caption-safe-zone-collision/);
    assert.match(result.prompt, /Timeline evidence preview/);
  });
});

test("skill catalog discovers layout safety review", async () => {
  const catalog = await listSkillCatalog({});
  const skill = catalog.skills.find((entry) => entry.slug === "layout-safety-review");

  assert.equal(skill?.name, "layout-safety-review");
  assert.match(skill?.description ?? "", /caption overlap/);
  assert.match(skill?.exampleRequestPath ?? "", /layout-safety-review\/examples\/request\.json/);
});
