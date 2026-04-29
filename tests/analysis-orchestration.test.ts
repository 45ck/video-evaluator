import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ANALYZER_REPORT_SCHEMA_VERSION,
  AnalyzerReportSchema,
  MEDIA_PROBE_SCHEMA_VERSION,
  QUALITY_GATES_SCHEMA_VERSION,
  analyzeBundle,
  analyzeVideo,
  normalizeMediaProbe,
  type AnalyzeVideoDependencies,
} from "../src/index.js";
import type { VideoTechnicalReviewRequest } from "../src/core/schemas.js";
import type { VideoTechnicalReport } from "../src/core/video-technical-review.js";

const createdAt = "2026-04-29T00:00:00.000Z";

function fakeDependencies(): AnalyzeVideoDependencies {
  return {
    now: () => new Date(createdAt),
    probeMedia: async (videoPath, options = {}) =>
      normalizeMediaProbe({
        filePath: resolve(videoPath),
        createdAt: (options.now ?? (() => new Date(createdAt)))().toISOString(),
        fileSizeBytes: 4096,
        ffprobe: {
          format: {
            format_name: "mov,mp4,m4a,3gp,3g2,mj2",
            duration: "8.000000",
            size: "4096",
            bit_rate: "1200000",
          },
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1080,
              height: 1920,
              pix_fmt: "yuv420p",
              avg_frame_rate: "30/1",
              duration: "8.000000",
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              channels: 2,
              sample_rate: "48000",
              duration: "8.000000",
            },
          ],
        },
      }),
    reviewVideoTechnical: async (input: VideoTechnicalReviewRequest) => {
      await mkdir(input.outputDir ?? "", { recursive: true });
      const reportPath = join(input.outputDir ?? "", "video-technical.report.json");
      const report: VideoTechnicalReport = {
        schemaVersion: "video-technical-report.v1",
        createdAt,
        videoPath: resolve(input.videoPath),
        outputDir: resolve(input.outputDir ?? ""),
        probe: {
          durationSeconds: 8,
          width: 1080,
          height: 1920,
          frameRate: 30,
          videoStreamCount: 1,
          audioStreamCount: 1,
          hasAudio: true,
        },
        audio: {},
        sampledFrameCount: 0,
        issues: [],
        metrics: {
          maxBlackPixelRatio: 0,
          maxWhitePixelRatio: 0,
          maxEdgeBlackRatio: 0,
          maxEdgeWhiteRatio: 0,
          longestLowMotionRunSeconds: 0,
          captionBandSparseCoverage: 0,
        },
        thresholds: {
          expectedWidth: 1080,
          expectedHeight: 1920,
          nearSilentMeanVolumeDb: -45,
          nearSilentMaxVolumeDb: -35,
          blackFramePixelRatio: 0.92,
          whiteFramePixelRatio: 0.92,
          edgeArtifactRatio: 0.82,
          maxContentExtremeRatioForEdgeArtifact: 0.25,
          lowMotionFrameDifference: 0.006,
          lowMotionMinRunSeconds: 1.5,
          captionBandSparseRatio: 0.01,
          captionBandSparseMinCoverage: 0.75,
        },
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return { reportPath, report };
    },
  };
}

test("analyzeVideo orchestrates media probe, gates, captions, and technical review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-analysis-"));
  try {
    const videoPath = join(dir, "render.mp4");
    const captionPath = join(dir, "subtitles.vtt");
    const outputDir = join(dir, "analysis");
    await writeFile(videoPath, "fake video");
    await writeFile(
      captionPath,
      `WEBVTT

00:00:00.000 --> 00:00:02.000
Open the dashboard

00:00:02.500 --> 00:00:04.500
Choose export
`,
    );

    const report = await analyzeVideo(
      {
        videoPath,
        outputDir,
        capabilities: ["media-probe", "quality-gates", "caption-artifacts"],
        options: {
          captionPath,
          runVideoTechnicalReview: true,
          qualityPolicy: {
            expectedDimensions: { width: 1080, height: 1920 },
            requireAudio: true,
          },
        },
      },
      fakeDependencies(),
    );

    const persisted = JSON.parse(await readFile(report.reportPath, "utf8"));
    assert.equal(report.schemaVersion, ANALYZER_REPORT_SCHEMA_VERSION);
    assert.equal(AnalyzerReportSchema.parse(persisted).status, "pass");
    assert.equal(report.mediaProbe?.schemaVersion, MEDIA_PROBE_SCHEMA_VERSION);
    assert.equal(report.qualityGates?.schemaVersion, QUALITY_GATES_SCHEMA_VERSION);
    assert.equal(report.qualityGates?.overallStatus, "pass");
    assert.equal(report.captionArtifacts[0]?.summary.cueCount, 2);
    assert.ok(report.artifacts.some((artifact) => artifact.name === "video-technical-report"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeBundle resolves bundle video and discovered captions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-bundle-"));
  try {
    const videoPath = join(dir, "output.mp4");
    const captionPath = join(dir, "subtitles.srt");
    await writeFile(videoPath, "fake video");
    await writeFile(
      captionPath,
      `1
00:00:00,000 --> 00:00:02,000
Open the dashboard
`,
    );

    const report = await analyzeBundle(
      {
        outputDir: dir,
        options: { runVideoTechnicalReview: false },
      },
      fakeDependencies(),
    );

    assert.equal(report.subject.kind, "bundle");
    assert.equal(report.subject.kind === "bundle" ? report.subject.bundleDir : "", resolve(dir));
    assert.equal(report.mediaProbe?.videoPath, resolve(videoPath));
    assert.equal(report.captionArtifacts.length, 1);
    assert.ok(report.artifacts.some((artifact) => artifact.name === "review-bundle"));
    assert.ok(report.artifacts.some((artifact) => artifact.path === resolve(captionPath)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
