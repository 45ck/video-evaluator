import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHybridTimestamps,
  buildUniformTimestamps,
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
