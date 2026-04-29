import { z } from "zod";
import {
  AnalyzerSubjectSchema,
  ArtifactReferenceSchema,
  ContractDiagnosticSchema,
  ContractSeveritySchema,
  ContractStatusSchema,
  EvidenceReferenceSchema,
  MetricValueSchema,
} from "./common.js";

export const QUALITY_GATES_SCHEMA_VERSION = "quality-gates.v1" as const;

export const QualityGateResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  status: ContractStatusSchema,
  severity: ContractSeveritySchema.default("warning"),
  message: z.string().min(1).optional(),
  recommendation: z.string().min(1).optional(),
  metrics: z.record(MetricValueSchema).default({}),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const QualityGateReportSchema = z.object({
  schemaVersion: z.literal(QUALITY_GATES_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  subject: AnalyzerSubjectSchema,
  overallStatus: ContractStatusSchema,
  gates: z.array(QualityGateResultSchema),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;
export type QualityGateReport = z.infer<typeof QualityGateReportSchema>;
