import { z } from "zod";

export const InstallSkillPackRequestSchema = z.object({
  targetDir: z.string().min(1),
  includeAgentRunner: z.boolean().default(true),
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
export type CompareBundlesRequest = z.infer<typeof CompareBundlesRequestSchema>;
export type PackageReviewPromptRequest = z.infer<typeof PackageReviewPromptRequestSchema>;
