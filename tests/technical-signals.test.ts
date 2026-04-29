import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeAudioSignals,
  summarizeEdgeGutter,
  summarizeFreezeBlackWhite,
  summarizeSceneCadence,
  summarizeTechnicalSignals,
  summarizeTemporalSignals,
  type TechnicalFrameMetrics,
} from "../src/signals/index.js";

function frame(
  overrides: Partial<TechnicalFrameMetrics> = {},
): TechnicalFrameMetrics {
  return {
    averageLuma: 0.5,
    blackPixelRatio: 0,
    whitePixelRatio: 0,
    edgeBlackRatio: 0,
    edgeWhiteRatio: 0,
    contentBlackRatio: 0,
    contentWhiteRatio: 0,
    ...overrides,
  };
}

test("summarizes scene cadence from cut timestamps", () => {
  const summary = summarizeSceneCadence({
    durationSeconds: 10,
    cutTimesSeconds: [2, 4, 6, 8],
    maxMedianCutIntervalSeconds: 3,
    minCutCount: 2,
  });

  assert.equal(summary.passed, true);
  assert.equal(summary.cutCount, 4);
  assert.equal(summary.medianCutIntervalSeconds, 2);
  assert.equal(summary.maxCutIntervalSeconds, 2);
});

test("detects black, white, and frozen frame runs from reusable frame metrics", () => {
  const frames = [
    frame({
      index: 1,
      blackPixelRatio: 0.95,
      motionScoreFromPrevious: undefined,
    }),
    frame({ index: 2, whitePixelRatio: 0.96, motionScoreFromPrevious: 0.002 }),
    frame({ index: 3, motionScoreFromPrevious: 0.002 }),
    frame({ index: 4, motionScoreFromPrevious: 0.002 }),
    frame({ index: 5, motionScoreFromPrevious: 0.002 }),
    frame({ index: 6, motionScoreFromPrevious: 0.04 }),
  ];

  const summary = summarizeFreezeBlackWhite(frames);

  assert.equal(summary.blackFrames, 1);
  assert.equal(summary.whiteFrames, 1);
  assert.equal(summary.freezeEvents, 1);
  assert.equal(summary.freezeRatio, 0.8);
  assert.equal(summary.totalFrames, 6);
});

test("does not treat absent luma and pixel ratios as black frames", () => {
  const summary = summarizeFreezeBlackWhite([
    { motionScoreFromPrevious: undefined },
    { motionScoreFromPrevious: 0.2 },
  ]);

  assert.equal(summary.blackFrames, 0);
  assert.equal(summary.whiteFrames, 0);
});

test("detects black gutters and white edge artifacts without flagging full-frame extremes", () => {
  const summary = summarizeEdgeGutter([
    frame({
      index: 1,
      timestampSeconds: 1.2,
      edgeBlackRatio: 0.9,
      contentBlackRatio: 0.1,
    }),
    frame({
      index: 2,
      edgeWhiteRatio: 0.91,
      contentWhiteRatio: 0.12,
    }),
    frame({
      index: 3,
      edgeWhiteRatio: 0.95,
      contentWhiteRatio: 0.8,
    }),
  ]);

  assert.equal(summary.blackGutterFrames, 1);
  assert.equal(summary.whiteEdgeFrames, 1);
  assert.deepEqual(
    summary.frames.map((item) => item.code),
    ["black-gutter", "white-edge"],
  );
});

test("summarizes duplicate runs and luminance flicker", () => {
  const summary = summarizeTemporalSignals([
    frame({ averageLuma: 0.1, motionScoreFromPrevious: undefined }),
    frame({ averageLuma: 0.9, motionScoreFromPrevious: 0.001 }),
    frame({ averageLuma: 0.1, motionScoreFromPrevious: 0.001 }),
    frame({ averageLuma: 0.9, motionScoreFromPrevious: 0.001 }),
    frame({ averageLuma: 0.1, motionScoreFromPrevious: 0.001 }),
  ]);

  assert.equal(summary.flicker.meanDiff, 204);
  assert.equal(summary.flicker.score, 0);
  assert.equal(summary.duplicateRunCount, 1);
  assert.equal(summary.duplicateFrameRatio, 1);
});

test("normalizes audio metrics from ffmpeg-style or volume-only inputs", () => {
  const summary = summarizeAudioSignals({
    meanVolumeDb: -50,
    maxVolumeDb: -40,
    clippingRatio: 0.03,
  });

  assert.equal(summary.loudnessLUFS, -50);
  assert.equal(summary.truePeakDBFS, -40);
  assert.equal(summary.nearSilent, true);
  assert.equal(summary.tooQuiet, true);
  assert.equal(summary.clipped, true);
});

test("builds one combined technical signal summary", () => {
  const summary = summarizeTechnicalSignals({
    durationSeconds: 8,
    cutTimesSeconds: [1, 2, 3],
    frames: [
      frame({ motionScoreFromPrevious: undefined }),
      frame({ motionScoreFromPrevious: 0.1 }),
    ],
    audio: { loudnessLUFS: -14, truePeakDBFS: -2 },
  });

  assert.equal(summary.sceneCadence?.passed, true);
  assert.equal(summary.freezeBlackWhite.totalFrames, 2);
  assert.equal(summary.temporal.framesAnalyzed, 2);
  assert.equal(summary.audio?.tooQuiet, false);
});
