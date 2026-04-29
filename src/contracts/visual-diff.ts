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

export const VISUAL_DIFF_SCHEMA_VERSION = "visual-diff.v1" as const;

export const VisualDiffFrameSchema = z.object({
  index: z.number().int().min(0).optional(),
  timestampSeconds: z.number().finite().min(0).optional(),
  leftFramePath: z.string().min(1).optional(),
  rightFramePath: z.string().min(1).optional(),
  diffImagePath: z.string().min(1).optional(),
  mismatchPixelCount: z.number().int().min(0).optional(),
  totalPixelCount: z.number().int().positive().optional(),
  mismatchPercent: z.number().finite().min(0).max(1),
  changedRegions: z
    .array(
      z.object({
        box: BoundingBoxSchema,
        mismatchPercent: z.number().finite().min(0).max(1).optional(),
        label: z.string().min(1).optional(),
      }),
    )
    .default([]),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const VisualDiffArtifactSchema = z.object({
  schemaVersion: z.literal(VISUAL_DIFF_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  subject: AnalyzerSubjectSchema.optional(),
  left: ArtifactReferenceSchema,
  right: ArtifactReferenceSchema,
  threshold: z.number().finite().min(0).max(1).optional(),
  overallStatus: ContractStatusSchema.default("unknown"),
  frames: z.array(VisualDiffFrameSchema),
  summary: z
    .object({
      comparedFrameCount: z.number().int().min(0),
      averageMismatchPercent: z.number().finite().min(0).max(1).optional(),
      maxMismatchPercent: z.number().finite().min(0).max(1).optional(),
      metrics: z.record(MetricValueSchema).default({}),
      notes: z.array(z.string()).default([]),
    })
    .optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type VisualDiffFrame = z.infer<typeof VisualDiffFrameSchema>;
export type VisualDiffArtifact = z.infer<typeof VisualDiffArtifactSchema>;
