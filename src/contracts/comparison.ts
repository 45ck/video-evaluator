import { z } from "zod";
import {
  AnalyzerSubjectSchema,
  ArtifactReferenceSchema,
  ContractDiagnosticSchema,
  ContractStatusSchema,
  MetricValueSchema,
} from "./common.js";
import { QualityGateResultSchema } from "./quality.js";
import { VisualDiffArtifactSchema } from "./visual-diff.js";

export const COMPARISON_ARTIFACT_SCHEMA_VERSION = "comparison-artifact.v1" as const;

export const ComparisonChangeSchema = z.object({
  kind: z.enum([
    "added",
    "removed",
    "changed",
    "unchanged",
    "improved",
    "regressed",
    "unknown",
  ]),
  path: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  status: ContractStatusSchema.default("unknown"),
  metrics: z.record(MetricValueSchema).default({}),
  notes: z.array(z.string()).default([]),
});

export const ComparisonArtifactSchema = z.object({
  schemaVersion: z.literal(COMPARISON_ARTIFACT_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  subject: AnalyzerSubjectSchema,
  left: AnalyzerSubjectSchema,
  right: AnalyzerSubjectSchema,
  overallStatus: ContractStatusSchema.default("unknown"),
  artifactChanges: z.array(ComparisonChangeSchema).default([]),
  mediaChanges: z.array(ComparisonChangeSchema).default([]),
  reportStatusChanges: z.array(ComparisonChangeSchema).default([]),
  qualityGateChanges: z.array(QualityGateResultSchema).default([]),
  visualDiffs: z.array(VisualDiffArtifactSchema).default([]),
  summary: z
    .object({
      changedArtifactCount: z.number().int().min(0).optional(),
      regressionCount: z.number().int().min(0).optional(),
      improvementCount: z.number().int().min(0).optional(),
      metrics: z.record(MetricValueSchema).default({}),
      notes: z.array(z.string()).default([]),
    })
    .optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type ComparisonChange = z.infer<typeof ComparisonChangeSchema>;
export type ComparisonArtifact = z.infer<typeof ComparisonArtifactSchema>;
