import { z } from "zod";
import {
  AnalyzerSubjectSchema,
  ArtifactReferenceSchema,
  BoundingBoxSchema,
  ContractDiagnosticSchema,
  ContractStatusSchema,
  EvidenceReferenceSchema,
  MetricValueSchema,
} from "./common.js";

export const CAPTION_ARTIFACT_SCHEMA_VERSION = "caption-artifact.v1" as const;

export const CaptionSourceSchema = z.enum([
  "asr",
  "ocr",
  "sidecar",
  "renderer",
  "expected",
  "manual",
]);

export const CaptionCueSchema = z
  .object({
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().min(0),
    id: z.string().min(1).optional(),
    text: z.string(),
    source: CaptionSourceSchema,
    confidence: z.number().finite().min(0).max(1).optional(),
    box: BoundingBoxSchema.optional(),
    framePath: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((value) => value.endSeconds >= value.startSeconds, {
    message: "endSeconds must be greater than or equal to startSeconds",
  });

export const CaptionQualitySummarySchema = z.object({
  status: ContractStatusSchema,
  cueCount: z.number().int().min(0),
  readableCueShare: z.number().finite().min(0).max(1).optional(),
  syncOffsetSecondsP50: z.number().finite().optional(),
  syncOffsetSecondsP95: z.number().finite().optional(),
  maxSafeZoneOverlapRatio: z.number().finite().min(0).optional(),
  metrics: z.record(MetricValueSchema).default({}),
  notes: z.array(z.string()).default([]),
});

export const CaptionArtifactSchema = z.object({
  schemaVersion: z.literal(CAPTION_ARTIFACT_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  subject: AnalyzerSubjectSchema,
  language: z.string().min(1).optional(),
  trackFormat: z.enum(["webvtt", "srt", "ass", "json", "unknown"]).default("unknown"),
  cues: z.array(CaptionCueSchema).default([]),
  expectedCues: z.array(CaptionCueSchema).default([]),
  ocrCues: z.array(CaptionCueSchema).default([]),
  summary: CaptionQualitySummarySchema,
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type CaptionSource = z.infer<typeof CaptionSourceSchema>;
export type CaptionCue = z.infer<typeof CaptionCueSchema>;
export type CaptionQualitySummary = z.infer<typeof CaptionQualitySummarySchema>;
export type CaptionArtifact = z.infer<typeof CaptionArtifactSchema>;
