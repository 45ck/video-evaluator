import { z } from "zod";
import {
  ANALYZER_REQUEST_SCHEMA_VERSION,
  AnalyzerCapabilitySchema,
} from "../contracts/analyzer.js";
import { ArtifactReferenceSchema, AnalyzerSubjectSchema } from "../contracts/common.js";

const AnalyzerOptionsSchema = z.record(z.unknown()).default({});

export const AnalyzeVideoRequestSchema = z
  .object({
    schemaVersion: z
      .literal(ANALYZER_REQUEST_SCHEMA_VERSION)
      .default(ANALYZER_REQUEST_SCHEMA_VERSION),
    requestId: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
    subject: AnalyzerSubjectSchema.optional(),
    videoPath: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
    capabilities: z.array(AnalyzerCapabilitySchema).default([]),
    artifacts: z.array(ArtifactReferenceSchema).default([]),
    options: AnalyzerOptionsSchema,
  })
  .refine(
    (input) =>
      Boolean(
        input.videoPath ||
          (input.subject?.kind === "video" && input.subject.videoPath) ||
          ((input.subject?.kind === "bundle" ||
            input.subject?.kind === "demo-capture") &&
            input.subject.videoPath),
      ),
    {
      message: "videoPath or subject.videoPath is required",
    },
  );

export const AnalyzeBundleRequestSchema = z.object({
  schemaVersion: z
    .literal(ANALYZER_REQUEST_SCHEMA_VERSION)
    .default(ANALYZER_REQUEST_SCHEMA_VERSION),
  requestId: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  latestPointerRoot: z.string().min(1).optional(),
  videoPath: z.string().min(1).optional(),
  analysisOutputDir: z.string().min(1).optional(),
  capabilities: z.array(AnalyzerCapabilitySchema).default([]),
  artifacts: z.array(ArtifactReferenceSchema).default([]),
  options: AnalyzerOptionsSchema,
});

export type AnalyzeVideoRequest = z.infer<typeof AnalyzeVideoRequestSchema>;
export type AnalyzeBundleRequest = z.infer<typeof AnalyzeBundleRequestSchema>;
