import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { buildTimelineEvidence } from "../src/core/timeline-evidence.js";
import { packageReviewPrompt } from "../src/harness/package-review-prompt.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-timeline-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildTimelineEvidence normalizes timestamps, events, and webvtt cues", async () => {
  await withTempDir(async (dir) => {
    const timestampsPath = join(dir, "timestamps.json");
    const eventsPath = join(dir, "events.json");
    const subtitlesPath = join(dir, "subtitles.vtt");
    const outputPath = join(dir, "timeline.evidence.json");

    await writeFile(
      timestampsPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        totalDuration: 4,
        ttsEngine: "mock",
        asrEngine: "mock",
        scenes: [
          {
            sceneId: "scene-001",
            audioStart: 0,
            audioEnd: 1,
            words: [
              { word: "hello", start: 0, end: 0.4, confidence: 0.9 },
              { word: "world", start: 0.4, end: 1, confidence: 0.8 },
            ],
          },
        ],
        allWords: [],
      })}\n`,
    );
    await writeFile(
      eventsPath,
      `${JSON.stringify([
        {
          action: "click",
          timestamp: 1.2,
          duration: 0.3,
          selector: "#submit",
        },
      ])}\n`,
    );
    await writeFile(
      subtitlesPath,
      "WEBVTT\n\n00:00:02.000 --> 00:00:03.500\nCaption line\n",
    );

    const manifest = await buildTimelineEvidence({
      rootDir: dir,
      artifacts: {
        "timestamps.json": timestampsPath,
        "events.json": eventsPath,
        "subtitles.vtt": subtitlesPath,
      },
      outputPath,
    });

    assert.ok(manifest);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.evidence.length, 3);
    assert.deepEqual(
      manifest.evidence.map((item) => item.kind),
      ["transcript", "action", "caption"],
    );
    assert.equal(manifest.evidence[0].text, "hello world");
    assert.equal(manifest.evidence[0].confidence, 0.85);
    assert.equal(manifest.evidence[1].action, "click");
    assert.equal(manifest.evidence[1].endSeconds, 1.5);
    assert.equal(manifest.evidence[2].text, "Caption line");

    const written = JSON.parse(await readFile(outputPath, "utf8")) as typeof manifest;
    assert.equal(written.summary.transcriptItems, 1);
    assert.equal(written.summary.actionItems, 1);
    assert.equal(written.summary.captionItems, 1);
    assert.equal(written.summary.durationSeconds, 3.5);
  });
});

test("intakeBundle writes timeline evidence when timeline source artifacts exist", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, "timestamps.json"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        totalDuration: 1,
        ttsEngine: "mock",
        asrEngine: "mock",
        allWords: [
          { word: "one", start: 0, end: 0.5, confidence: 1 },
          { word: "two", start: 0.5, end: 1, confidence: 1 },
        ],
      })}\n`,
    );

    const bundle = await intakeBundle({ outputDir: dir });

    assert.equal(bundle.artifacts["timestamps.json"], join(dir, "timestamps.json"));
    assert.equal(bundle.artifacts["timeline.evidence.json"], join(dir, "timeline.evidence.json"));
    assert.ok(bundle.recommendedFocus.includes("audio timeline"));
    assert.ok(bundle.recommendedFocus.includes("timeline evidence"));

    const timeline = JSON.parse(await readFile(join(dir, "timeline.evidence.json"), "utf8")) as {
      evidence: Array<{ text?: string }>;
    };
    assert.equal(timeline.evidence[0].text, "one two");
  });
});

test("packageReviewPrompt includes timeline evidence preview", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      join(dir, "events.json"),
      `${JSON.stringify([{ action: "navigate", timestamp: 0.2, duration: 0.1 }])}\n`,
    );

    const result = await packageReviewPrompt({ outputDir: dir });

    assert.ok(result.bundle.artifacts["timeline.evidence.json"]);
    assert.match(result.prompt, /Timeline evidence preview/);
    assert.match(result.prompt, /action 0\.20-0\.30s: navigate/);
  });
});
