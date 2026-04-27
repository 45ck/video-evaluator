import { z } from "zod";

export const InstallSkillPackRequestSchema = z.object({
  targetDir: z.string().min(1),
  includeAgentRunner: z.boolean().default(true),
  installDependencies: z.boolean().default(true),
});

export const SkillCatalogRequestSchema = z.object({}).default({});

export const VideoIntakeRequestSchema = z.object({
  outputDir: z.string().min(1).optional(),
  latestPointerRoot: z.string().min(1).optional(),
  videoPath: z.string().min(1).optional(),
});

export const ReviewBundleRequestSchema = VideoIntakeRequestSchema.extend({
  includePromptHints: z.boolean().default(true),
});

export const StoryboardExtractRequestSchema = z.object({
  videoPath: z.string().min(1),
  outputDir: z.string().min(1).optional(),
  frameCount: z.number().int().min(1).max(24).default(6),
  format: z.enum(["jpg", "png"]).default("jpg"),
  samplingMode: z.enum(["uniform", "hybrid"]).default("uniform"),
  changeThreshold: z.number().min(0.01).max(1).default(0.08),
});

export const VideoShotsRequestSchema = z.object({
  videoPath: z.string().min(1),
  outputDir: z.string().min(1).optional(),
  sceneThreshold: z.number().min(0.01).max(1).default(0.08),
  minShotDurationSeconds: z.number().min(0.1).max(30).default(0.5),
  extractRepresentativeFrames: z.boolean().default(true),
});

export const SegmentEvidenceRequestSchema = VideoIntakeRequestSchema.extend({
  outputPath: z.string().min(1).optional(),
  maxTextItemsPerSegment: z.number().int().min(1).max(50).default(8),
});

export const StoryboardOcrRequestSchema = z.object({
  storyboardDir: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  minConfidence: z.number().min(0).max(100).default(45),
}).refine((input) => Boolean(input.storyboardDir || input.manifestPath), {
  message: "storyboardDir or manifestPath is required",
});

export const StoryboardUnderstandRequestSchema = z.object({
  storyboardDir: z.string().min(1).optional(),
  ocrPath: z.string().min(1).optional(),
}).refine((input) => Boolean(input.storyboardDir || input.ocrPath), {
  message: "storyboardDir or ocrPath is required",
});

export const StoryboardTransitionsRequestSchema = z.object({
  storyboardDir: z.string().min(1).optional(),
  ocrPath: z.string().min(1).optional(),
  threshold: z.number().min(0).max(1).default(0.02),
}).refine((input) => Boolean(input.storyboardDir || input.ocrPath), {
  message: "storyboardDir or ocrPath is required",
});

export const CompareBundlesRequestSchema = z.object({
  left: VideoIntakeRequestSchema,
  right: VideoIntakeRequestSchema,
});

export const PackageReviewPromptRequestSchema = VideoIntakeRequestSchema.extend({
  specPath: z.string().min(1).optional(),
  focus: z.array(z.string()).default([]),
});

export type SkillCatalogRequest = z.infer<typeof SkillCatalogRequestSchema>;
export type InstallSkillPackRequest = z.infer<typeof InstallSkillPackRequestSchema>;
export type VideoIntakeRequest = z.infer<typeof VideoIntakeRequestSchema>;
export type ReviewBundleRequest = z.infer<typeof ReviewBundleRequestSchema>;
export type StoryboardExtractRequest = z.infer<typeof StoryboardExtractRequestSchema>;
export type VideoShotsRequest = z.infer<typeof VideoShotsRequestSchema>;
export type SegmentEvidenceRequest = z.infer<typeof SegmentEvidenceRequestSchema>;
export type StoryboardOcrRequest = z.infer<typeof StoryboardOcrRequestSchema>;
export type StoryboardUnderstandRequest = z.infer<typeof StoryboardUnderstandRequestSchema>;
export type StoryboardTransitionsRequest = z.infer<typeof StoryboardTransitionsRequestSchema>;
export type CompareBundlesRequest = z.infer<typeof CompareBundlesRequestSchema>;
export type PackageReviewPromptRequest = z.infer<typeof PackageReviewPromptRequestSchema>;
