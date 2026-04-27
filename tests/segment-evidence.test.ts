import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { intakeBundle } from "../src/core/bundle.js";
import { buildSegmentEvidence } from "../src/core/segment-evidence.js";
import { packageReviewPrompt } from "../src/harness/package-review-prompt.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-segment-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildSegmentEvidence fuses shots, storyboard, OCR, transitions, and timeline evidence", async () => {
  await withTempDir(async (dir) => {
    const videoPath = join(dir, "sample.mp4");
    await writeFile(videoPath, "");
    await writeJson(join(dir, "video.shots.json"), {
      schemaVersion: 1,
      videoPath,
      shots: [
        { index: 1, startSeconds: 0, endSeconds: 5, durationSeconds: 5, representativeTimestampSeconds: 2.5 },
        { index: 2, startSeconds: 5, endSeconds: 10, durationSeconds: 5, representativeTimestampSeconds: 7.5 },
      ],
    });
    await writeJson(join(dir, "storyboard.manifest.json"), {
      schemaVersion: 1,
      videoPath,
      frames: [
        { index: 1, timestampSeconds: 2, imagePath: join(dir, "frame-01.jpg"), samplingReason: "uniform" },
        { index: 2, timestampSeconds: 7, imagePath: join(dir, "frame-02.jpg"), samplingReason: "change-peak" },
      ],
    });
    await writeJson(join(dir, "storyboard.ocr.json"), {
      schemaVersion: 2,
      videoPath,
      frames: [
        {
          index: 1,
          timestampSeconds: 2,
          imagePath: join(dir, "frame-01.jpg"),
          semanticLines: [{ text: "Dashboard", confidence: 91, evidenceRole: "ui" }],
          lines: [{ text: "Dashboard", confidence: 91 }],
          quality: { status: "usable" },
        },
        {
          index: 2,
          timestampSeconds: 7,
          imagePath: join(dir, "frame-02.jpg"),
          semanticLines: [],
          lines: [],
          quality: { status: "reject" },
        },
      ],
    });
    await writeJson(join(dir, "storyboard.transitions.json"), {
      schemaVersion: 1,
      videoPath,
      transitions: [
        {
          fromFrameIndex: 1,
          toFrameIndex: 2,
          fromTimestampSeconds: 2,
          toTimestampSeconds: 7,
          transitionKind: "screen-change",
          inferredTransition: "screen changed",
          confidence: 0.8,
        },
      ],
    });
    await writeJson(join(dir, "timeline.evidence.json"), {
      schemaVersion: 1,
      evidence: [
        { id: "timeline-0001", kind: "caption", sourceType: "subtitles-vtt", startSeconds: 6, endSeconds: 8, text: "Open settings" },
      ],
    });

    const result = await buildSegmentEvidence({ outputDir: dir });

    assert.equal(result.manifest.segments.length, 2);
    assert.equal(result.manifest.segments[0].evidenceStatus, "usable");
    assert.equal(result.manifest.segments[0].textEvidence[0].text, "Dashboard");
    assert.equal(result.manifest.segments[1].evidenceStatus, "usable");
    assert.equal(result.manifest.segments[1].evidenceCounts.timelineItems, 1);
    assert.equal(result.manifest.segments[1].textEvidence[0].text, "Open settings");

    const written = JSON.parse(await readFile(join(dir, "segment.evidence.json"), "utf8")) as typeof result.manifest;
    assert.equal(written.summary.segmentCount, 2);
    assert.ok(written.summary.sourceArtifacts.includes("video.shots.json"));
  });
});

test("intakeBundle and packageReviewPrompt discover segment evidence", async () => {
  await withTempDir(async (dir) => {
    await writeJson(join(dir, "segment.evidence.json"), {
      schemaVersion: 1,
      segments: [
        {
          index: 1,
          startSeconds: 0,
          endSeconds: 2,
          evidenceStatus: "weak",
          evidenceCounts: { storyboardFrames: 1, timelineItems: 0, transitions: 0 },
          textEvidence: [{ text: "Menu" }],
        },
      ],
    });

    const bundle = await intakeBundle({ outputDir: dir });
    const prompt = await packageReviewPrompt({ outputDir: dir });

    assert.equal(bundle.artifacts["segment.evidence.json"], join(dir, "segment.evidence.json"));
    assert.ok(bundle.recommendedFocus.includes("segment evidence"));
    assert.match(prompt.prompt, /Segment evidence preview/);
    assert.match(prompt.prompt, /segment 1 0\.00-2\.00s status=weak/);
  });
});

test("intakeBundle discovers storyboard artifacts in a nested storyboard directory", async () => {
  await withTempDir(async (dir) => {
    const storyboardDir = join(dir, "storyboard");
    await mkdir(storyboardDir);
    await writeJson(join(storyboardDir, "storyboard.manifest.json"), {
      schemaVersion: 1,
      frames: [],
    });

    const bundle = await intakeBundle({ outputDir: dir });

    assert.equal(bundle.artifacts["storyboard.manifest.json"], join(storyboardDir, "storyboard.manifest.json"));
    assert.ok(bundle.recommendedFocus.includes("storyboard evidence"));
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
