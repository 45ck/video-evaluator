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

export const DEMO_CAPTURE_EVIDENCE_SCHEMA_VERSION =
  "demo-capture-evidence.v1" as const;

export const DemoCaptureEventSchema = z
  .object({
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().min(0).optional(),
    id: z.string().min(1).optional(),
    type: z.enum([
      "navigation",
      "click",
      "input",
      "scroll",
      "hover",
      "wait",
      "assertion",
      "screenshot",
      "other",
    ]),
    label: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    targetBox: BoundingBoxSchema.optional(),
    screenshotPath: z.string().min(1).optional(),
    evidence: z.array(EvidenceReferenceSchema).default([]),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (value) =>
      value.endSeconds === undefined || value.endSeconds >= value.startSeconds,
    {
      message: "endSeconds must be greater than or equal to startSeconds",
    },
  );

export const DemoCaptureEvidenceArtifactSchema = z.object({
  schemaVersion: z.literal(DEMO_CAPTURE_EVIDENCE_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  subject: AnalyzerSubjectSchema,
  captureId: z.string().min(1).optional(),
  videoPath: z.string().min(1).optional(),
  pageUrl: z.string().min(1).optional(),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      deviceScaleFactor: z.number().finite().positive().optional(),
    })
    .optional(),
  events: z.array(DemoCaptureEventSchema).default([]),
  screenshotEvidence: z.array(EvidenceReferenceSchema).default([]),
  cursorEvidence: z.array(EvidenceReferenceSchema).default([]),
  targetEvidence: z.array(EvidenceReferenceSchema).default([]),
  summary: z
    .object({
      status: ContractStatusSchema.default("unknown"),
      eventCount: z.number().int().min(0),
      screenshotCount: z.number().int().min(0),
      metrics: z.record(MetricValueSchema).default({}),
      notes: z.array(z.string()).default([]),
    })
    .optional(),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  diagnostics: z.array(ContractDiagnosticSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type DemoCaptureEvent = z.infer<typeof DemoCaptureEventSchema>;
export type DemoCaptureEvidenceArtifact = z.infer<
  typeof DemoCaptureEvidenceArtifactSchema
>;
