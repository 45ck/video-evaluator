import { z } from "zod";

export const ContractStatusSchema = z.enum([
  "pass",
  "warn",
  "fail",
  "skip",
  "unknown",
]);

export const ContractSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

export const TimeRangeSecondsSchema = z
  .object({
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().min(0),
  })
  .refine((value) => value.endSeconds >= value.startSeconds, {
    message: "endSeconds must be greater than or equal to startSeconds",
  });

export const BoundingBoxSchema = z
  .object({
    x0: z.number().finite(),
    y0: z.number().finite(),
    x1: z.number().finite(),
    y1: z.number().finite(),
    coordinateSpace: z.enum(["pixels", "normalized"]).default("pixels"),
  })
  .refine((value) => value.x1 >= value.x0, {
    message: "x1 must be greater than or equal to x0",
  })
  .refine((value) => value.y1 >= value.y0, {
    message: "y1 must be greater than or equal to y0",
  });

export const ArtifactReferenceSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
  schemaVersion: z.union([z.string().min(1), z.number().int()]).optional(),
  createdAt: z.string().min(1).optional(),
});

export const EvidenceReferenceSchema = z.object({
  artifactName: z.string().min(1).optional(),
  artifactPath: z.string().min(1).optional(),
  framePath: z.string().min(1).optional(),
  timestampSeconds: z.number().finite().min(0).optional(),
  timeRange: TimeRangeSecondsSchema.optional(),
  box: BoundingBoxSchema.optional(),
  note: z.string().min(1).optional(),
});

export const MetricValueSchema = z.object({
  value: z.union([z.number().finite(), z.string(), z.boolean()]),
  unit: z.string().min(1).optional(),
  threshold: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
  status: ContractStatusSchema.optional(),
});

const AnalyzerLeafSubjectSchema = z
  .object({
    kind: z.enum(["video", "bundle", "demo-capture"]),
    videoPath: z.string().min(1).optional(),
    bundleDir: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (value) => {
      if (value.kind === "video") return Boolean(value.videoPath);
      if (value.kind === "bundle" || value.kind === "demo-capture") {
        return Boolean(value.bundleDir || value.videoPath);
      }
      return true;
    },
    {
      message:
        "subject requires videoPath for videos and bundleDir or videoPath for bundles/captures",
    },
  );

export const AnalyzerSubjectSchema = z.union([
  AnalyzerLeafSubjectSchema,
  z.object({
    kind: z.literal("comparison"),
    left: AnalyzerLeafSubjectSchema,
    right: AnalyzerLeafSubjectSchema,
    outputDir: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
]);

export const ContractDiagnosticSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: ContractSeveritySchema.default("warning"),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type ContractStatus = z.infer<typeof ContractStatusSchema>;
export type ContractSeverity = z.infer<typeof ContractSeveritySchema>;
export type TimeRangeSeconds = z.infer<typeof TimeRangeSecondsSchema>;
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type MetricValue = z.infer<typeof MetricValueSchema>;
export type AnalyzerSubject = z.infer<typeof AnalyzerSubjectSchema>;
export type ContractDiagnostic = z.infer<typeof ContractDiagnosticSchema>;
