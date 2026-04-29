import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  analyzePngFrame,
  buildVideoTechnicalReport,
  type FrameTechnicalMetrics,
  type VideoTechnicalThresholds,
} from "../src/core/video-technical-review.js";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: new (input: { width: number; height: number }) => {
    width: number;
    height: number;
    data: Buffer;
  } & { constructor: { sync: { write: (png: unknown) => Buffer } } };
};
const PngSync = require("pngjs").PNG as {
  sync: { write: (png: unknown) => Buffer };
};

const thresholds: VideoTechnicalThresholds = {
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
};

function frame(
  index: number,
  overrides: Partial<FrameTechnicalMetrics> = {},
): FrameTechnicalMetrics {
  return {
    index,
    timestampSeconds: index - 1,
    width: 1080,
    height: 1920,
    averageLuma: 0.5,
    blackPixelRatio: 0,
    whitePixelRatio: 0,
    edgeBlackRatio: 0,
    edgeWhiteRatio: 0,
    contentBlackRatio: 0,
    contentWhiteRatio: 0,
    captionBandDetailRatio: 0.03,
    ...overrides,
  };
}

test("buildVideoTechnicalReport preserves content-machine technical issue codes", () => {
  const report = buildVideoTechnicalReport({
    videoPath: "/tmp/output.mp4",
    outputDir: "/tmp/review",
    probe: {
      durationSeconds: 4,
      width: 720,
      height: 1280,
      videoStreamCount: 1,
      audioStreamCount: 0,
      hasAudio: false,
    },
    frames: [
      frame(1, {
        whitePixelRatio: 0.95,
        edgeWhiteRatio: 0.9,
        contentWhiteRatio: 0.1,
        captionBandDetailRatio: 0,
      }),
      frame(2, {
        blackPixelRatio: 0.94,
        edgeBlackRatio: 0.91,
        contentBlackRatio: 0.1,
        captionBandDetailRatio: 0,
        motionScoreFromPrevious: 0.003,
      }),
      frame(3, {
        captionBandDetailRatio: 0,
        motionScoreFromPrevious: 0.004,
      }),
      frame(4, {
        captionBandDetailRatio: 0,
        motionScoreFromPrevious: 0.005,
      }),
    ],
    thresholds,
    expectAudio: true,
    expectCaptions: true,
  });

  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has("wrong-resolution"));
  assert.ok(codes.has("missing-audio"));
  assert.ok(codes.has("white-flash-or-white-frame"));
  assert.ok(codes.has("black-frame"));
  assert.ok(codes.has("white-edge-artifact"));
  assert.ok(codes.has("black-gutter-artifact"));
  assert.ok(codes.has("low-motion-run"));
  assert.ok(codes.has("caption-band-sparse"));
  assert.equal(report.metrics.longestLowMotionRunSeconds, 2);
  assert.equal(report.metrics.captionBandSparseCoverage, 1);
});

test("buildVideoTechnicalReport detects near silent audio", () => {
  const report = buildVideoTechnicalReport({
    videoPath: "/tmp/output.mp4",
    outputDir: "/tmp/review",
    probe: {
      durationSeconds: 4,
      width: 1080,
      height: 1920,
      videoStreamCount: 1,
      audioStreamCount: 1,
      hasAudio: true,
    },
    audio: {
      meanVolumeDb: -51,
      maxVolumeDb: -42,
    },
    frames: [frame(1), frame(2), frame(3), frame(4)],
    thresholds,
    expectAudio: true,
    expectCaptions: false,
  });

  assert.ok(report.issues.some((issue) => issue.code === "near-silent-audio"));
});

test("buildVideoTechnicalReport passes through only layout-* issues", () => {
  const report = buildVideoTechnicalReport({
    videoPath: "/tmp/output.mp4",
    outputDir: "/tmp/review",
    probe: {
      durationSeconds: 4,
      width: 1080,
      height: 1920,
      videoStreamCount: 1,
      audioStreamCount: 1,
      hasAudio: true,
    },
    frames: [],
    thresholds,
    expectAudio: false,
    expectCaptions: false,
    layoutIssues: [
      {
        severity: "error",
        code: "layout-caption-overlap",
        message: "Caption overlaps a control.",
        timeSeconds: 1.2,
      },
      {
        severity: "warning",
        code: "black-frame",
        message: "Not a layout pass-through issue.",
      },
    ] as never,
  });

  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ["layout-caption-overlap"],
  );
});

test("analyzePngFrame computes edge and frame metrics from png pixels", () => {
  const png = new PNG({ width: 20, height: 20 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (png.width * y + x) << 2;
      const isEdge = x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1;
      png.data[offset] = isEdge ? 255 : 32;
      png.data[offset + 1] = isEdge ? 255 : 32;
      png.data[offset + 2] = isEdge ? 255 : 32;
      png.data[offset + 3] = 255;
    }
  }

  const metrics = analyzePngFrame(PngSync.sync.write(png), {
    index: 1,
    timestampSeconds: 0.5,
  });

  assert.equal(metrics.width, 20);
  assert.equal(metrics.height, 20);
  assert.ok(metrics.edgeWhiteRatio > 0.5);
  assert.ok(metrics.contentWhiteRatio < 0.1);
});
