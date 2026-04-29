import { z } from "zod";
import { ArtifactReferenceSchema, ContractDiagnosticSchema } from "./common.js";

export const MEDIA_PROBE_SCHEMA_VERSION = "media-probe.v1" as const;

export const MediaProbeVideoStreamSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codecName: z.string().min(1).optional(),
  codecLongName: z.string().min(1).optional(),
  pixelFormat: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  frameRateFps: z.number().finite().positive().optional(),
  durationSeconds: z.number().finite().min(0).optional(),
  frameCount: z.number().int().min(0).optional(),
  bitRateBitsPerSecond: z.number().finite().min(0).optional(),
  displayAspectRatio: z.string().min(1).optional(),
  rotationDegrees: z.number().finite().optional(),
  hasAlpha: z.boolean().optional(),
});

export const MediaProbeAudioStreamSchema = z.object({
  present: z.boolean(),
  codecName: z.string().min(1).optional(),
  codecLongName: z.string().min(1).optional(),
  sampleRateHz: z.number().finite().positive().optional(),
  channels: z.number().int().positive().optional(),
  channelLayout: z.string().min(1).optional(),
  durationSeconds: z.number().finite().min(0).optional(),
  bitRateBitsPerSecond: z.number().finite().min(0).optional(),
});

export const MediaProbeContainerSchema = z.object({
  formatName: z.string().min(1).optional(),
  formatLongName: z.string().min(1).optional(),
  durationSeconds: z.number().finite().min(0).optional(),
  bitRateBitsPerSecond: z.number().finite().min(0).optional(),
});

export const MediaProbeArtifactSchema = z.object({
  schemaVersion: z.literal(MEDIA_PROBE_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  videoPath: z.string().min(1),
  file: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().min(0).optional(),
    modifiedAt: z.string().min(1).optional(),
  }),
  container: MediaProbeContainerSchema.default({}),
  video: MediaProbeVideoStreamSchema.optional(),
  audio: MediaProbeAudioStreamSchema.default({ present: false }),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  probeTool: z
    .object({
      name: z.string().min(1),
      version: z.string().min(1).optional(),
      command: z.string().min(1).optional(),
    })
    .optional(),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type MediaProbeVideoStream = z.infer<typeof MediaProbeVideoStreamSchema>;
export type MediaProbeAudioStream = z.infer<typeof MediaProbeAudioStreamSchema>;
export type MediaProbeContainer = z.infer<typeof MediaProbeContainerSchema>;
export type MediaProbeArtifact = z.infer<typeof MediaProbeArtifactSchema>;
