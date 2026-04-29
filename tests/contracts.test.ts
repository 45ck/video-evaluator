import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  ANALYZER_REPORT_SCHEMA_VERSION,
  ANALYZER_REQUEST_SCHEMA_VERSION,
  AnalyzerReportSchema,
  AnalyzerRequestSchema,
  AnalyzerSubjectSchema,
  CAPTION_ARTIFACT_SCHEMA_VERSION,
  COMPARISON_ARTIFACT_SCHEMA_VERSION,
  CaptionArtifactSchema,
  ComparisonArtifactSchema,
  DEMO_CAPTURE_EVIDENCE_SCHEMA_VERSION,
  DemoCaptureEvidenceArtifactSchema,
  MEDIA_PROBE_SCHEMA_VERSION,
  MediaProbeArtifactSchema,
  QUALITY_GATES_SCHEMA_VERSION,
  QualityGateReportSchema,
  VISUAL_DIFF_SCHEMA_VERSION,
  VisualDiffArtifactSchema,
} from "../src/contracts/index.js";

const createdAt = "2026-04-29T00:00:00.000Z";
const videoSubject = { kind: "video" as const, videoPath: "/tmp/render.mp4" };

test("canonical contract package boundary is declared", async () => {
  const pkg = JSON.parse(
    await readFile(join(process.cwd(), "package.json"), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
  };

  assert.ok(pkg.exports?.["."]);
  assert.ok(pkg.exports?.["./contracts"]);
});

test("analyzer request validates versioned subject and capabilities", () => {
  const request = AnalyzerRequestSchema.parse({
    schemaVersion: ANALYZER_REQUEST_SCHEMA_VERSION,
    subject: videoSubject,
    capabilities: ["media-probe", "quality-gates", "caption-artifacts"],
  });

  assert.equal(request.schemaVersion, "analyzer-request.v1");
  assert.deepEqual(request.options, {});
  assert.equal(
    AnalyzerSubjectSchema.safeParse({ kind: "video" }).success,
    false,
  );
});

test("media probe contract accepts pragmatic ffprobe facts", () => {
  const probe = MediaProbeArtifactSchema.parse({
    schemaVersion: MEDIA_PROBE_SCHEMA_VERSION,
    createdAt,
    videoPath: "/tmp/render.mp4",
    file: { path: "/tmp/render.mp4", sizeBytes: 1024 },
    video: {
      width: 1080,
      height: 1920,
      codecName: "h264",
      frameRateFps: 30,
      durationSeconds: 12.5,
    },
    audio: { present: true, codecName: "aac", channels: 2 },
  });

  assert.equal(probe.audio.present, true);
  assert.equal(probe.container.formatName, undefined);
});

test("quality gate report carries gate status, metrics, and evidence", () => {
  const report = QualityGateReportSchema.parse({
    schemaVersion: QUALITY_GATES_SCHEMA_VERSION,
    createdAt,
    subject: videoSubject,
    overallStatus: "warn",
    gates: [
      {
        id: "caption-safe-zone",
        status: "warn",
        metrics: {
          overlap: { value: 0.07, unit: "ratio", threshold: 0.02 },
        },
        evidence: [{ timestampSeconds: 1.2, note: "caption collision" }],
      },
    ],
  });

  assert.equal(report.gates[0]?.severity, "warning");
  assert.equal(report.gates[0]?.metrics.overlap?.value, 0.07);
});

test("caption artifact validates cues and rejects inverted cue ranges", () => {
  const artifact = CaptionArtifactSchema.parse({
    schemaVersion: CAPTION_ARTIFACT_SCHEMA_VERSION,
    createdAt,
    subject: videoSubject,
    cues: [
      {
        startSeconds: 0,
        endSeconds: 1.5,
        text: "Open settings",
        source: "ocr",
      },
    ],
    summary: {
      status: "pass",
      cueCount: 1,
      readableCueShare: 1,
    },
  });

  assert.equal(artifact.trackFormat, "unknown");
  assert.equal(
    CaptionArtifactSchema.safeParse({
      ...artifact,
      cues: [{ startSeconds: 2, endSeconds: 1, text: "bad", source: "ocr" }],
    }).success,
    false,
  );
});

test("visual diff contract records frame-level mismatch evidence", () => {
  const diff = VisualDiffArtifactSchema.parse({
    schemaVersion: VISUAL_DIFF_SCHEMA_VERSION,
    createdAt,
    left: { name: "before", path: "/tmp/before.png" },
    right: { name: "after", path: "/tmp/after.png" },
    frames: [
      {
        timestampSeconds: 3,
        mismatchPercent: 0.12,
        changedRegions: [
          {
            box: { x0: 0, y0: 0, x1: 100, y1: 100 },
            label: "hero-card",
          },
        ],
      },
    ],
  });

  assert.equal(diff.overallStatus, "unknown");
  assert.equal(diff.frames[0]?.changedRegions[0]?.box.coordinateSpace, "pixels");
});

test("demo capture evidence contract accepts screenshot and cursor evidence", () => {
  const evidence = DemoCaptureEvidenceArtifactSchema.parse({
    schemaVersion: DEMO_CAPTURE_EVIDENCE_SCHEMA_VERSION,
    createdAt,
    subject: { kind: "demo-capture", bundleDir: "/tmp/demo-run" },
    events: [
      {
        startSeconds: 1,
        type: "click",
        selector: "#save",
        targetBox: { x0: 10, y0: 10, x1: 50, y1: 40 },
      },
    ],
    screenshotEvidence: [{ framePath: "/tmp/frame.png", timestampSeconds: 1 }],
  });

  assert.equal(evidence.events[0]?.type, "click");
  assert.equal(evidence.summary, undefined);
});

test("comparison and analyzer report contracts compose canonical artifacts", () => {
  const comparison = ComparisonArtifactSchema.parse({
    schemaVersion: COMPARISON_ARTIFACT_SCHEMA_VERSION,
    createdAt,
    subject: {
      kind: "comparison",
      left: { kind: "bundle", bundleDir: "/tmp/left" },
      right: { kind: "bundle", bundleDir: "/tmp/right" },
    },
    left: { kind: "bundle", bundleDir: "/tmp/left" },
    right: { kind: "bundle", bundleDir: "/tmp/right" },
    artifactChanges: [{ kind: "changed", status: "warn", label: "quality" }],
  });

  const report = AnalyzerReportSchema.parse({
    schemaVersion: ANALYZER_REPORT_SCHEMA_VERSION,
    createdAt,
    subject: comparison.subject,
    status: "warn",
    comparison,
    artifacts: [{ name: "comparison", path: "/tmp/comparison.json" }],
  });

  assert.equal(report.comparison?.schemaVersion, "comparison-artifact.v1");
  assert.deepEqual(report.captionArtifacts, []);
});
