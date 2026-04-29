import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  MEDIA_PROBE_SCHEMA,
  normalizeMediaProbe,
  parseFps,
  probeMedia,
  type MediaProbeArtifact,
  type RawFfprobePayload,
} from "../src/probe/media.js";
import { evaluateRenderQualityGates, QUALITY_GATES_SCHEMA } from "../src/quality/gates.js";

const createdAt = "2026-04-29T00:00:00.000Z";

function ffprobePayload(overrides: Partial<RawFfprobePayload> = {}): RawFfprobePayload {
  return {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      format_long_name: "QuickTime / MOV",
      duration: "10.250000",
      size: "2048",
      bit_rate: "1598",
    },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        codec_long_name: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
        width: 1080,
        height: 1920,
        pix_fmt: "yuv420p",
        avg_frame_rate: "30000/1001",
        duration: "10.200000",
        bit_rate: "1200000",
      },
      {
        index: 1,
        codec_type: "audio",
        codec_name: "aac",
        codec_long_name: "AAC (Advanced Audio Coding)",
        channels: 2,
        sample_rate: "48000",
        duration: "10.240000",
        bit_rate: "128000",
      },
    ],
    ...overrides,
  };
}

function normalize(overrides: Partial<RawFfprobePayload> = {}): MediaProbeArtifact {
  return normalizeMediaProbe({
    filePath: "/tmp/render.mp4",
    ffprobe: ffprobePayload(overrides),
    fileSizeBytes: 4096,
    createdAt,
  });
}

test("parseFps normalizes rational and numeric frame rates", () => {
  assert.equal(parseFps("30000/1001"), 29.97);
  assert.equal(parseFps("24"), 24);
  assert.equal(parseFps(60), 60);
  assert.equal(parseFps("0/0"), null);
  assert.equal(parseFps("not-a-rate"), null);
});

test("normalizeMediaProbe emits media.probe.v1 with core media facts", () => {
  const probe = normalize();

  assert.equal(probe.schema, MEDIA_PROBE_SCHEMA);
  assert.equal(probe.createdAt, createdAt);
  assert.equal(probe.durationSeconds, 10.25);
  assert.equal(probe.sizeBytes, 4096);
  assert.equal(probe.container.formatName, "mov,mp4,m4a,3gp,3g2,mj2");
  assert.equal(probe.hasVideo, true);
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.video?.width, 1080);
  assert.equal(probe.video?.height, 1920);
  assert.equal(probe.video?.codecName, "h264");
  assert.equal(probe.video?.pixelFormat, "yuv420p");
  assert.equal(probe.video?.fps, 29.97);
  assert.equal(probe.audio?.codecName, "aac");
  assert.equal(probe.audio?.sampleRateHz, 48000);
});

test("normalizeMediaProbe keeps invalid metadata as nulls instead of guessing", () => {
  const probe = normalizeMediaProbe({
    filePath: "/tmp/bad.mp4",
    createdAt,
    ffprobe: {
      format: { format_name: "", duration: "N/A", size: "-1" },
      streams: [
        {
          codec_type: "video",
          width: 0,
          height: "oops",
          pix_fmt: "",
          avg_frame_rate: "0/0",
          duration: "-2",
        },
      ],
    },
  });

  assert.equal(probe.durationSeconds, null);
  assert.equal(probe.sizeBytes, null);
  assert.equal(probe.container.formatName, null);
  assert.equal(probe.video?.width, null);
  assert.equal(probe.video?.height, null);
  assert.equal(probe.video?.pixelFormat, null);
  assert.equal(probe.video?.fps, null);
});

test("probeMedia runs ffprobe and prefers filesystem size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "video-evaluator-probe-"));
  try {
    const videoPath = join(dir, "sample.mp4");
    await writeFile(videoPath, "fake-media");
    const calls: Array<{ file: string; args: string[] }> = [];

    const probe = await probeMedia(videoPath, {
      now: () => new Date(createdAt),
      execFile: async (file, args) => {
        calls.push({ file, args });
        return { stdout: JSON.stringify(ffprobePayload()) };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "ffprobe");
    assert.ok(calls[0].args.includes("-show_streams"));
    assert.ok(calls[0].args.includes("-show_format"));
    assert.equal(calls[0].args.at(-1), resolve(videoPath));
    assert.equal(probe.filePath, resolve(videoPath));
    assert.equal(probe.sizeBytes, "fake-media".length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluateRenderQualityGates passes a compliant render", () => {
  const result = evaluateRenderQualityGates(
    normalize(),
    {
      expectedDimensions: { width: 1080, height: 1920 },
      allowedContainers: ["mp4"],
      allowedVideoCodecs: ["h264"],
      allowedAudioCodecs: ["aac"],
      allowedPixelFormats: ["yuv420p"],
      requireAudio: true,
      minDurationSeconds: 9,
      maxDurationSeconds: 11,
      minFps: 29,
      maxFps: 30,
      minFileSizeBytes: 1024,
      audioVideoDurationToleranceSeconds: 0.1,
    },
    { now: () => new Date(createdAt) },
  );

  assert.equal(result.schema, QUALITY_GATES_SCHEMA);
  assert.equal(result.createdAt, createdAt);
  assert.equal(result.mediaProbeSchema, MEDIA_PROBE_SCHEMA);
  assert.equal(result.status, "pass");
  assert.deepEqual(new Set(result.checks.map((check) => check.status)), new Set(["pass"]));
});

test("evaluateRenderQualityGates fails missing streams and invalid metadata", () => {
  const probe = normalizeMediaProbe({
    filePath: "/tmp/audio-only.mp4",
    createdAt,
    fileSizeBytes: 0,
    ffprobe: {
      format: { format_name: "mp4", duration: "0" },
      streams: [{ codec_type: "audio", codec_name: "aac" }],
    },
  });
  const result = evaluateRenderQualityGates(probe, { requireAudio: true });
  const checks = new Map(result.checks.map((check) => [check.id, check]));

  assert.equal(result.status, "fail");
  assert.equal(checks.get("video-stream-present")?.status, "fail");
  assert.equal(checks.get("duration-valid")?.status, "fail");
  assert.equal(checks.get("file-size-valid")?.status, "fail");
  assert.equal(checks.get("dimensions")?.status, "fail");
  assert.equal(checks.get("fps")?.status, "fail");
  assert.equal(checks.get("pixel-format")?.status, "fail");
});

test("evaluateRenderQualityGates fails wrong resolution and unsupported formats", () => {
  const result = evaluateRenderQualityGates(normalize(), {
    expectedDimensions: { width: 1920, height: 1080 },
    allowedContainers: ["webm"],
    allowedVideoCodecs: ["vp9"],
    allowedAudioCodecs: ["opus"],
    allowedPixelFormats: ["yuv444p"],
    requireAudio: true,
    expectedFps: 24,
    fpsTolerance: 0.01,
    maxFileSizeBytes: 100,
  });
  const checks = new Map(result.checks.map((check) => [check.id, check]));

  assert.equal(result.status, "fail");
  assert.equal(checks.get("dimensions")?.status, "fail");
  assert.equal(checks.get("container")?.status, "fail");
  assert.equal(checks.get("video-codec")?.status, "fail");
  assert.equal(checks.get("audio-codec")?.status, "fail");
  assert.equal(checks.get("pixel-format")?.status, "fail");
  assert.equal(checks.get("fps")?.status, "fail");
  assert.equal(checks.get("file-size-valid")?.status, "fail");
});

test("evaluateRenderQualityGates fails audio/video duration mismatch", () => {
  const result = evaluateRenderQualityGates(
    normalize({
      format: { format_name: "mp4", duration: "12" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          pix_fmt: "yuv420p",
          avg_frame_rate: "30/1",
          duration: "12",
        },
        { codec_type: "audio", codec_name: "aac", duration: "9" },
      ],
    }),
    { requireAudio: true, audioVideoDurationToleranceSeconds: 0.25 },
  );

  const mismatch = result.checks.find((check) => check.id === "audio-video-duration-match");
  assert.equal(result.status, "fail");
  assert.equal(mismatch?.status, "fail");
  assert.equal(mismatch?.actual, 3);
});
