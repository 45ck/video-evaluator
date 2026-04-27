import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { planSegmentStoryboardFrames } from "../src/core/segment-storyboard.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-segment-storyboard-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("planSegmentStoryboardFrames creates one representative frame per shot", () => {
  const frames = planSegmentStoryboardFrames({
    framesPerSegment: 1,
    shots: [
      { index: 1, startSeconds: 0, endSeconds: 10, durationSeconds: 10, representativeTimestampSeconds: 4 },
      { index: 2, startSeconds: 10, endSeconds: 20, durationSeconds: 10 },
    ],
  });

  assert.deepEqual(
    frames.map((frame) => [frame.sourceShotIndex, frame.timestampSeconds, frame.segmentPosition]),
    [
      [1, 4, "middle"],
      [2, 15, "middle"],
    ],
  );
});

test("planSegmentStoryboardFrames can sample early, middle, and late positions", () => {
  const frames = planSegmentStoryboardFrames({
    framesPerSegment: 3,
    shots: [{ index: 7, startSeconds: 10, endSeconds: 18, durationSeconds: 8 }],
  });

  assert.deepEqual(
    frames.map((frame) => frame.segmentPosition),
    ["early", "middle", "late"],
  );
  assert.equal(frames[0].sourceShotIndex, 7);
  assert.ok(frames[0].timestampSeconds > 10);
  assert.ok(frames[2].timestampSeconds < 18);
});

test("intakeBundle prefers segment-storyboard artifacts over global storyboard artifacts", async () => {
  await withTempDir(async (dir) => {
    const globalStoryboardDir = join(dir, "storyboard");
    const segmentStoryboardDir = join(dir, "segment-storyboard");
    await mkdir(globalStoryboardDir);
    await mkdir(segmentStoryboardDir);
    await writeJson(join(globalStoryboardDir, "storyboard.manifest.json"), {
      schemaVersion: 1,
      samplingMode: "hybrid",
      frames: [],
    });
    await writeJson(join(segmentStoryboardDir, "storyboard.manifest.json"), {
      schemaVersion: 1,
      samplingMode: "segment",
      frames: [],
    });

    const bundle = await intakeBundle({ outputDir: dir });

    assert.equal(bundle.artifacts["storyboard.manifest.json"], join(segmentStoryboardDir, "storyboard.manifest.json"));
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
