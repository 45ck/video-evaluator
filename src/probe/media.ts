import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MEDIA_PROBE_SCHEMA = "media.probe.v1" as const;

export interface RawFfprobePayload {
  streams?: Array<Record<string, unknown>>;
  format?: Record<string, unknown>;
}

export interface MediaContainerProbe {
  formatName: string | null;
  formatLongName: string | null;
  bitRate: number | null;
}

export interface MediaStreamProbe {
  index: number | null;
  type: string | null;
  codecName: string | null;
  codecLongName: string | null;
  durationSeconds: number | null;
  bitRate: number | null;
}

export interface MediaVideoProbe extends MediaStreamProbe {
  type: "video";
  width: number | null;
  height: number | null;
  pixelFormat: string | null;
  fps: number | null;
}

export interface MediaAudioProbe extends MediaStreamProbe {
  type: "audio";
  channels: number | null;
  sampleRateHz: number | null;
}

export interface MediaProbeArtifact {
  schema: typeof MEDIA_PROBE_SCHEMA;
  createdAt: string;
  filePath: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  container: MediaContainerProbe;
  hasVideo: boolean;
  hasAudio: boolean;
  video: MediaVideoProbe | null;
  audio: MediaAudioProbe | null;
  streams: {
    video: MediaVideoProbe[];
    audio: MediaAudioProbe[];
    other: MediaStreamProbe[];
  };
}

export interface NormalizeMediaProbeInput {
  filePath: string;
  ffprobe: RawFfprobePayload;
  fileSizeBytes?: number | null;
  createdAt?: string;
}

export interface ProbeMediaOptions {
  ffprobePath?: string;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string }>;
  now?: () => Date;
}

export async function probeMedia(
  filePath: string,
  options: ProbeMediaOptions = {},
): Promise<MediaProbeArtifact> {
  const resolvedPath = resolve(filePath);
  const runner = options.execFile ?? defaultExecFile;
  const [fileStat, probeResult] = await Promise.all([
    stat(resolvedPath),
    runner(options.ffprobePath ?? "ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      resolvedPath,
    ]),
  ]);
  return normalizeMediaProbe({
    filePath: resolvedPath,
    ffprobe: JSON.parse(probeResult.stdout) as RawFfprobePayload,
    fileSizeBytes: fileStat.size,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  });
}

export function normalizeMediaProbe(input: NormalizeMediaProbeInput): MediaProbeArtifact {
  const format = input.ffprobe.format ?? {};
  const streams = input.ffprobe.streams ?? [];
  const videoStreams = streams
    .filter((stream) => stringOrNull(stream.codec_type) === "video")
    .map(normalizeVideoStream);
  const audioStreams = streams
    .filter((stream) => stringOrNull(stream.codec_type) === "audio")
    .map(normalizeAudioStream);
  const otherStreams = streams
    .filter((stream) => {
      const type = stringOrNull(stream.codec_type);
      return type !== "video" && type !== "audio";
    })
    .map(normalizeGenericStream);

  const formatDuration = positiveNumberOrNull(format.duration);
  const durationSeconds =
    formatDuration ??
    firstNumber(videoStreams.map((stream) => stream.durationSeconds)) ??
    firstNumber(audioStreams.map((stream) => stream.durationSeconds));
  const formatSize = nonNegativeIntegerOrNull(format.size);
  const sizeBytes = nonNegativeIntegerOrNull(input.fileSizeBytes) ?? formatSize;

  return {
    schema: MEDIA_PROBE_SCHEMA,
    createdAt: input.createdAt ?? new Date().toISOString(),
    filePath: input.filePath,
    durationSeconds,
    sizeBytes,
    container: {
      formatName: stringOrNull(format.format_name),
      formatLongName: stringOrNull(format.format_long_name),
      bitRate: positiveNumberOrNull(format.bit_rate),
    },
    hasVideo: videoStreams.length > 0,
    hasAudio: audioStreams.length > 0,
    video: videoStreams[0] ?? null,
    audio: audioStreams[0] ?? null,
    streams: {
      video: videoStreams,
      audio: audioStreams,
      other: otherStreams,
    },
  };
}

export function parseFps(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (trimmed.includes("/")) {
    const [numeratorRaw, denominatorRaw] = trimmed.split("/", 2);
    const numerator = Number(numeratorRaw);
    const denominator = Number(denominatorRaw);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }
    const fps = numerator / denominator;
    return Number.isFinite(fps) && fps > 0 ? roundNumber(fps, 3) : null;
  }
  const fps = Number(trimmed);
  return Number.isFinite(fps) && fps > 0 ? roundNumber(fps, 3) : null;
}

function normalizeVideoStream(stream: Record<string, unknown>): MediaVideoProbe {
  const generic = normalizeGenericStream(stream);
  return {
    ...generic,
    type: "video",
    width: positiveIntegerOrNull(stream.width),
    height: positiveIntegerOrNull(stream.height),
    pixelFormat: stringOrNull(stream.pix_fmt),
    fps: parseFps(stream.avg_frame_rate) ?? parseFps(stream.r_frame_rate),
  };
}

function normalizeAudioStream(stream: Record<string, unknown>): MediaAudioProbe {
  const generic = normalizeGenericStream(stream);
  return {
    ...generic,
    type: "audio",
    channels: positiveIntegerOrNull(stream.channels),
    sampleRateHz: positiveIntegerOrNull(stream.sample_rate),
  };
}

function normalizeGenericStream(stream: Record<string, unknown>): MediaStreamProbe {
  return {
    index: nonNegativeIntegerOrNull(stream.index),
    type: stringOrNull(stream.codec_type),
    codecName: stringOrNull(stream.codec_name),
    codecLongName: stringOrNull(stream.codec_long_name),
    durationSeconds: positiveNumberOrNull(stream.duration),
    bitRate: positiveNumberOrNull(stream.bit_rate),
  };
}

function firstNumber(values: Array<number | null>): number | null {
  return values.find((value): value is number => typeof value === "number") ?? null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? roundNumber(number, 6) : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = positiveNumberOrNull(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 ? number : null;
}

function roundNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

async function defaultExecFile(file: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(file, args);
  return { stdout };
}
