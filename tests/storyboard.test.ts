import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHybridTimestamps,
  buildUniformTimestamps,
  inferSameScreenProbeScore,
} from "../src/core/storyboard.js";

test("buildUniformTimestamps returns evenly spaced timestamps", () => {
  assert.deepEqual(buildUniformTimestamps(70, 6), [10, 20, 30, 40, 50, 60]);
});

test("buildHybridTimestamps falls back to uniform when no candidates exist", () => {
  assert.deepEqual(buildHybridTimestamps(70, 6, []), [10, 20, 30, 40, 50, 60]);
});

test("buildHybridTimestamps preserves spread while biasing toward candidate changes", () => {
  const timestamps = buildHybridTimestamps(90, 8, [7, 8, 24, 25, 43, 61, 62, 80]);
  assert.equal(timestamps.length, 8);
  const matchedCandidates = [7, 24, 43, 61, 80].filter((candidate) =>
    timestamps.some((value) => Math.abs(value - candidate) < 0.01),
  );
  assert.ok(matchedCandidates.length >= 3);
  assert.deepEqual([...timestamps].sort((a, b) => a - b), timestamps);
});

test("buildHybridTimestamps dedupes dense candidate clusters and still fills the frame budget", () => {
  const timestamps = buildHybridTimestamps(48, 6, [5, 5.1, 5.2, 20, 20.1, 35]);
  assert.equal(timestamps.length, 6);
  assert.ok(timestamps.some((value) => Math.abs(value - 5) < 0.25));
  assert.ok(timestamps.some((value) => Math.abs(value - 20) < 0.25));
  assert.ok(timestamps.some((value) => Math.abs(value - 35) < 0.25));
});

test("inferSameScreenProbeScore favors local changes when top chrome stays stable", () => {
  const score = inferSameScreenProbeScore({
    overallDiffPercent: 0.08,
    topDiffPercent: 0.01,
    middleDiffPercent: 0.09,
    bottomDiffPercent: 0.03,
  });
  assert.ok(score > 0.3);
});

test("inferSameScreenProbeScore rejects hard cuts even when lower regions changed", () => {
  const score = inferSameScreenProbeScore({
    overallDiffPercent: 0.24,
    topDiffPercent: 0.02,
    middleDiffPercent: 0.14,
    bottomDiffPercent: 0.11,
  });
  assert.equal(score, 0);
});

test("inferSameScreenProbeScore allows moderate top motion when lower regions clearly dominate", () => {
  const score = inferSameScreenProbeScore({
    overallDiffPercent: 0.1457,
    topDiffPercent: 0.0736,
    middleDiffPercent: 0.2022,
    bottomDiffPercent: 0.1215,
  });
  assert.ok(score > 0);
});

test("buildHybridTimestamps can prioritize scored same-screen candidates", () => {
  const timestamps = buildHybridTimestamps(80, 6, [
    { timestampSeconds: 12, source: "scene-change", score: 0.4 },
    { timestampSeconds: 18, source: "same-screen-change", score: 0.95 },
    { timestampSeconds: 19, source: "same-screen-change", score: 0.92 },
    { timestampSeconds: 44, source: "scene-change", score: 0.5 },
    { timestampSeconds: 61, source: "same-screen-change", score: 0.9 },
  ]);
  assert.equal(timestamps.length, 6);
  assert.ok(timestamps.some((value) => Math.abs(value - 18) < 0.01));
  assert.ok(timestamps.some((value) => Math.abs(value - 61) < 0.01));
});
