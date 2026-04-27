import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { packageReviewPrompt } from "../src/harness/package-review-prompt.js";
import { buildShotSegments } from "../src/core/video-shots.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-shots-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildShotSegments creates ordered segments from scene boundaries", () => {
  const shots = buildShotSegments({
    durationSeconds: 10,
    boundaries: [3, 7],
  });

  assert.deepEqual(
    shots.map((shot) => ({
      index: shot.index,
      startSeconds: shot.startSeconds,
      endSeconds: shot.endSeconds,
      durationSeconds: shot.durationSeconds,
      representativeTimestampSeconds: shot.representativeTimestampSeconds,
      boundaryStart: shot.boundaryStart,
      boundaryEnd: shot.boundaryEnd,
    })),
    [
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 3,
        durationSeconds: 3,
        representativeTimestampSeconds: 1.5,
        boundaryStart: "video-start",
        boundaryEnd: "scene-change",
      },
      {
        index: 2,
        startSeconds: 3,
        endSeconds: 7,
        durationSeconds: 4,
        representativeTimestampSeconds: 5,
        boundaryStart: "scene-change",
        boundaryEnd: "scene-change",
      },
      {
        index: 3,
        startSeconds: 7,
        endSeconds: 10,
        durationSeconds: 3,
        representativeTimestampSeconds: 8.5,
        boundaryStart: "scene-change",
        boundaryEnd: "video-end",
      },
    ],
  );
});

test("packageReviewPrompt includes shot structure preview", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, "video.shots.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        shots: [
          {
            index: 1,
            startSeconds: 0,
            endSeconds: 2.5,
            durationSeconds: 2.5,
            representativeFramePath: join(dir, "video-shots", "shot-001.jpg"),
          },
        ],
      })}\n`,
    );

    const result = await packageReviewPrompt({ outputDir: dir });

    assert.match(result.prompt, /Shot structure preview/);
    assert.match(result.prompt, /shot 1 0\.00-2\.50s/);
    assert.ok(result.bundle.recommendedFocus.includes("video shot structure"));
  });
});

test("intakeBundle prefers the video path referenced by shot artifacts", async () => {
  await withTempDir(async (dir) => {
    const sampleVideoPath = join(dir, "sample.mp4");
    await writeFile(sampleVideoPath, "");
    await writeFile(join(dir, "download.mp4"), "");
    await writeFile(
      join(dir, "video.shots.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        videoPath: sampleVideoPath,
        shots: [],
      })}\n`,
    );

    const bundle = await intakeBundle({ outputDir: dir });

    assert.equal(bundle.videoPath, sampleVideoPath);
    assert.equal(bundle.artifacts.video, sampleVideoPath);
  });
});

test("buildShotSegments filters invalid and too-close boundaries", () => {
  const shots = buildShotSegments({
    durationSeconds: 6,
    boundaries: [-1, 0, 1, 1.2, 5.8, 9],
    minShotDurationSeconds: 0.5,
  });

  assert.equal(shots.length, 2);
  assert.deepEqual(
    shots.map((shot) => [shot.startSeconds, shot.endSeconds]),
    [
      [0, 1],
      [1, 6],
    ],
  );
});
