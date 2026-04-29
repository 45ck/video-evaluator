import { z } from "zod";
import {
  AnalyzerSubjectSchema,
  ArtifactReferenceSchema,
  ContractDiagnosticSchema,
  ContractStatusSchema,
  MetricValueSchema,
} from "./common.js";
import { CaptionArtifactSchema } from "./captions.js";
import { ComparisonArtifactSchema } from "./comparison.js";
import { DemoCaptureEvidenceArtifactSchema } from "./demo-capture.js";
import { MediaProbeArtifactSchema } from "./media.js";
import { QualityGateReportSchema } from "./quality.js";
import { VisualDiffArtifactSchema } from "./visual-diff.js";

export const ANALYZER_REQUEST_SCHEMA_VERSION = "analyzer-request.v1" as const;
export const ANALYZER_REPORT_SCHEMA_VERSION = "analyzer-report.v1" as const;

export const AnalyzerCapabilitySchema = z.enum([
  "media-probe",
  "quality-gates",
  "caption-artifacts",
  "visual-diff",
  "demo-capture-evidence",
  "comparison",
  "timeline-evidence",
  "layout-safety",
  "storyboard",
  "review-bundle",
]);

export const AnalyzerRequestSchema = z.object({
  schemaVersion: z.literal(ANALYZER_REQUEST_SCHEMA_VERSION),
  requestId: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  subject: AnalyzerSubjectSchema,
  capabilities: z.array(AnalyzerCapabilitySchema).default([]),
  outputDir: z.string().min(1).optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  options: z.record(z.unknown()).default({}),
});

export const AnalyzerReportSchema = z.object({
  schemaVersion: z.literal(ANALYZER_REPORT_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  request: AnalyzerRequestSchema.optional(),
  subject: AnalyzerSubjectSchema,
  status: ContractStatusSchema,
  metrics: z.record(MetricValueSchema).default({}),
  mediaProbe: MediaProbeArtifactSchema.optional(),
  qualityGates: QualityGateReportSchema.optional(),
  captionArtifacts: z.array(CaptionArtifactSchema).default([]),
  visualDiffs: z.array(VisualDiffArtifactSchema).default([]),
  demoCaptureEvidence: DemoCaptureEvidenceArtifactSchema.optional(),
  comparison: ComparisonArtifactSchema.optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type AnalyzerCapability = z.infer<typeof AnalyzerCapabilitySchema>;
export type AnalyzerRequest = z.infer<typeof AnalyzerRequestSchema>;
export type AnalyzerReport = z.infer<typeof AnalyzerReportSchema>;
