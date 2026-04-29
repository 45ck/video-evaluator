import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { SourceMediaSignalsRequestSchema } from "../src/core/schemas.js";
import {
  SOURCE_MEDIA_SIGNALS_SCHEMA_VERSION,
  buildSourceMediaSignals,
  parseAudioSignals,
} from "../src/source-media/signals.js";
import { normalizeMediaProbe, type MediaProbeArtifact } from "../src/probe/media.js";

const createdAt = "2026-04-29T00:00:00.000Z";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-source-signals-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mediaProbe(filePath: string, overrides: { hasAudio?: boolean; hasVideo?: boolean } = {}): MediaProbeArtifact {
  const streams: Array<Record<string, unknown>> = [];
  if (overrides.hasVideo !== false) {
    streams.push({
      codec_type: "video",
      codec_name: "h264",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30/1",
      duration: "6",
    });
  }
  if (overrides.hasAudio !== false) {
    streams.push({
      codec_type: "audio",
      codec_name: "aac",
      channels: 2,
      sample_rate: "48000",
      duration: "6",
    });
  }
  return normalizeMediaProbe({
    filePath,
    createdAt,
    fileSizeBytes: 4096,
    ffprobe: {
      format: { format_name: "mp4", duration: "6", bit_rate: "1200000" },
      streams,
    },
  });
}

test("parseAudioSignals extracts volume and silence evidence from ffmpeg stderr", () => {
  const signals = parseAudioSignals(
    [
      "[Parsed_silencedetect_1] silence_start: 1.25",
      "[Parsed_silencedetect_1] silence_end: 2.5 | silence_duration: 1.25",
      "[Parsed_volumedetect_0] mean_volume: -18.4 dB",
      "[Parsed_volumedetect_0] max_volume: -2.1 dB",
    ].join("\n"),
    10,
    { silenceNoiseDb: -35, silenceMinDurationSeconds: 0.25 },
  );

  assert.equal(signals.status, "available");
  assert.equal(signals.meanVolumeDb, -18.4);
  assert.equal(signals.maxVolumeDb, -2.1);
  assert.deepEqual(signals.silenceSegments, [
    { startSeconds: 1.25, endSeconds: 2.5, durationSeconds: 1.25 },
  ]);
  assert.equal(signals.totalSilenceSeconds, 1.25);
  assert.equal(signals.silentShare, 0.125);
});

test("buildSourceMediaSignals writes manifest with probe facts, audio, shots, frames, and placeholders", async () => {
  await withTempDir(async (dir) => {
    const videoPath = join(dir, "sample.mp4");
    await writeFile(videoPath, "fake-media");
    const input = SourceMediaSignalsRequestSchema.parse({
      videoPath,
      outputDir: dir,
      sceneThreshold: 0.12,
      extractRepresentativeFrames: true,
    });

    const result = await buildSourceMediaSignals(input, {
      now: () => new Date(createdAt),
      probe: async () => mediaProbe(resolve(videoPath)),
      analyzeAudio: async () => ({
        status: "available",
        hasAudio: true,
        meanVolumeDb: -20,
        maxVolumeDb: -3,
        silenceThresholdDb: -35,
        minSilenceDurationSeconds: 0.25,
        silenceSegments: [{ startSeconds: 1, endSeconds: 1.5, durationSeconds: 0.5 }],
        totalSilenceSeconds: 0.5,
        silentShare: 0.0833,
      }),
      extractShots: async () => ({
        manifestPath: join(dir, "video.shots.json"),
        manifest: {
          schemaVersion: 1,
          createdAt,
          videoPath: resolve(videoPath),
          outputDir: dir,
          durationSeconds: 6,
          sceneThreshold: 0.12,
          minShotDurationSeconds: 0.5,
          detectedBoundaryCount: 1,
          shots: [
            {
              index: 1,
              startSeconds: 0,
              endSeconds: 3,
              durationSeconds: 3,
              representativeTimestampSeconds: 1.5,
              representativeFramePath: join(dir, "video-shots", "shot-001.jpg"),
              boundaryStart: "video-start",
              boundaryEnd: "scene-change",
            },
            {
              index: 2,
              startSeconds: 3,
              endSeconds: 6,
              durationSeconds: 3,
              representativeTimestampSeconds: 4.5,
              representativeFramePath: join(dir, "video-shots", "shot-002.jpg"),
              boundaryStart: "scene-change",
              boundaryEnd: "video-end",
            },
          ],
        },
      }),
    });

    const persisted = JSON.parse(await readFile(result.manifestPath, "utf8")) as typeof result.manifest;

    assert.equal(result.manifest.schemaVersion, SOURCE_MEDIA_SIGNALS_SCHEMA_VERSION);
    assert.equal(result.manifest.createdAt, createdAt);
    assert.equal(result.manifest.ffprobe.status, "available");
    assert.equal(result.manifest.ffprobe.facts.hasAudio, true);
    assert.equal(result.manifest.audio.status, "available");
    assert.equal(result.manifest.video.status, "available");
    assert.equal(result.manifest.video.shotCount, 2);
    assert.equal(result.manifest.representativeFrames.status, "available");
    assert.equal(result.manifest.representativeFrames.framePaths.length, 2);
    assert.equal(result.manifest.textRisk.status, "placeholder");
    assert.deepEqual(persisted, result.manifest);
  });
});

test("buildSourceMediaSignals marks unavailable audio without running ffmpeg", async () => {
  await withTempDir(async (dir) => {
    const videoPath = join(dir, "silent.mp4");
    await writeFile(videoPath, "fake-media");
    const input = SourceMediaSignalsRequestSchema.parse({
      videoPath,
      outputDir: dir,
      runVideoShots: false,
    });
    let audioCalled = false;

    const result = await buildSourceMediaSignals(input, {
      probe: async () => mediaProbe(resolve(videoPath), { hasAudio: false }),
      analyzeAudio: async () => {
        audioCalled = true;
        throw new Error("should not run");
      },
    });

    assert.equal(audioCalled, false);
    assert.equal(result.manifest.audio.status, "unavailable");
    assert.equal(result.manifest.audio.hasAudio, false);
    assert.equal(result.manifest.video.status, "skipped");
    assert.equal(result.manifest.representativeFrames.status, "skipped");
  });
});

test("buildSourceMediaSignals recovers shot estimates when representative frame extraction fails", async () => {
  await withTempDir(async (dir) => {
    const videoPath = join(dir, "sample.mp4");
    await writeFile(videoPath, "fake-media");
    const input = SourceMediaSignalsRequestSchema.parse({ videoPath, outputDir: dir });
    const calls: boolean[] = [];

    const result = await buildSourceMediaSignals(input, {
      probe: async () => mediaProbe(resolve(videoPath)),
      analyzeAudio: async (_path, parsedInput, probe) => ({
        status: "skipped",
        hasAudio: probe.hasAudio,
        meanVolumeDb: null,
        maxVolumeDb: null,
        silenceThresholdDb: parsedInput.silenceNoiseDb,
        minSilenceDurationSeconds: parsedInput.silenceMinDurationSeconds,
        silenceSegments: [],
        totalSilenceSeconds: null,
        silentShare: null,
      }),
      extractShots: async (shotInput) => {
        calls.push(shotInput.extractRepresentativeFrames);
        if (shotInput.extractRepresentativeFrames) {
          throw new Error("frame extraction failed");
        }
        return {
          manifestPath: join(dir, "video.shots.json"),
          manifest: {
            schemaVersion: 1,
            createdAt,
            videoPath: resolve(videoPath),
            outputDir: dir,
            durationSeconds: 6,
            sceneThreshold: shotInput.sceneThreshold,
            minShotDurationSeconds: shotInput.minShotDurationSeconds,
            detectedBoundaryCount: 0,
            shots: [
              {
                index: 1,
                startSeconds: 0,
                endSeconds: 6,
                durationSeconds: 6,
                representativeTimestampSeconds: 3,
                boundaryStart: "video-start",
                boundaryEnd: "video-end",
              },
            ],
          },
        };
      },
    });

    assert.deepEqual(calls, [true, false]);
    assert.equal(result.manifest.video.status, "available");
    assert.equal(result.manifest.video.shotCount, 1);
    assert.equal(result.manifest.representativeFrames.status, "failed");
    assert.match(result.manifest.representativeFrames.diagnostic ?? "", /recovered without frames/);
  });
});
