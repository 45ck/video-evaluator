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

export const SourceMediaSignalsRequestSchema = VideoShotsRequestSchema.extend({
  outputPath: z.string().min(1).optional(),
  runAudioSignals: z.boolean().default(true),
  runVideoShots: z.boolean().default(true),
  silenceNoiseDb: z.number().min(-120).max(0).default(-35),
  silenceMinDurationSeconds: z.number().min(0.05).max(10).default(0.25),
});

export const SegmentEvidenceRequestSchema = VideoIntakeRequestSchema.extend({
  outputPath: z.string().min(1).optional(),
  maxTextItemsPerSegment: z.number().int().min(1).max(50).default(8),
});

export const SegmentStoryboardRequestSchema = VideoIntakeRequestSchema.extend({
  storyboardOutputDir: z.string().min(1).optional(),
  framesPerSegment: z.number().int().min(1).max(3).default(1),
  format: z.enum(["jpg", "png"]).default("jpg"),
});

export const StoryboardOcrRequestSchema = z
  .object({
    storyboardDir: z.string().min(1).optional(),
    manifestPath: z.string().min(1).optional(),
    minConfidence: z.number().min(0).max(100).default(45),
  })
  .refine((input) => Boolean(input.storyboardDir || input.manifestPath), {
    message: "storyboardDir or manifestPath is required",
  });

export const StoryboardUnderstandRequestSchema = z
  .object({
    storyboardDir: z.string().min(1).optional(),
    ocrPath: z.string().min(1).optional(),
  })
  .refine((input) => Boolean(input.storyboardDir || input.ocrPath), {
    message: "storyboardDir or ocrPath is required",
  });

export const StoryboardTransitionsRequestSchema = z
  .object({
    storyboardDir: z.string().min(1).optional(),
    ocrPath: z.string().min(1).optional(),
    threshold: z.number().min(0).max(1).default(0.02),
  })
  .refine((input) => Boolean(input.storyboardDir || input.ocrPath), {
    message: "storyboardDir or ocrPath is required",
  });

export const LayoutSafetyReviewRequestSchema = z.object({
  videoPath: z.string().min(1),
  outputDir: z.string().min(1).optional(),
  layoutPath: z.string().min(1).optional(),
  frameCount: z.number().int().min(1).max(24).default(8),
  samplingMode: z.enum(["uniform", "hybrid"]).default("hybrid"),
  runOcr: z.boolean().default(true),
  minOcrConfidence: z.number().min(0).max(100).default(45),
  maxPairOverlapRatio: z.number().min(0).max(1).default(0.04),
  maxCaptionZoneOverlapRatio: z.number().min(0).max(1).default(0.02),
});

export const VideoTechnicalReviewRequestSchema = z.object({
  videoPath: z.string().min(1),
  outputDir: z.string().min(1).optional(),
  expectedWidth: z.number().int().min(1).optional().default(1080),
  expectedHeight: z.number().int().min(1).optional().default(1920),
  expectAudio: z.boolean().default(true),
  expectCaptions: z.boolean().default(true),
  frameSampleCount: z.number().int().min(2).max(48).default(12),
  layoutReportPath: z.string().min(1).optional(),
  nearSilentMeanVolumeDb: z.number().max(0).default(-45),
  nearSilentMaxVolumeDb: z.number().max(0).default(-35),
  blackFramePixelRatio: z.number().min(0).max(1).default(0.92),
  whiteFramePixelRatio: z.number().min(0).max(1).default(0.92),
  edgeArtifactRatio: z.number().min(0).max(1).default(0.82),
  maxContentExtremeRatioForEdgeArtifact: z.number().min(0).max(1).default(0.25),
  lowMotionFrameDifference: z.number().min(0).max(1).default(0.006),
  lowMotionMinRunSeconds: z.number().min(0).max(60).default(1.5),
  captionBandSparseRatio: z.number().min(0).max(1).default(0.01),
  captionBandSparseMinCoverage: z.number().min(0).max(1).default(0.75),
});

export const CompareBundlesRequestSchema = z.object({
  left: VideoIntakeRequestSchema,
  right: VideoIntakeRequestSchema,
});

const VisualGateStatusSchema = z.enum(["pass", "warn", "fail", "skip"]);

export const GoldenFrameCompareRequestSchema = z.object({
  baselineFramePath: z.string().min(1),
  currentFramePath: z.string().min(1),
  outputDir: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  mode: z.enum(["compare", "update"]).default("compare"),
  pixelmatchThreshold: z.number().min(0).max(1).default(0.1),
  maxMismatchPercent: z.number().min(0).max(1).default(0.001),
  warnMismatchPercent: z.number().min(0).max(1).optional(),
  missingBaselineStatus: VisualGateStatusSchema.default("skip"),
});

export const DemoVisualFrameRequestSchema = z.object({
  id: z.string().min(1).optional(),
  baselineFramePath: z.string().min(1).optional(),
  currentFramePath: z.string().min(1),
  timestampSeconds: z.number().finite().min(0).optional(),
});

export const DemoVisualReviewRequestSchema = z
  .object({
    baselineDir: z.string().min(1).optional(),
    currentDir: z.string().min(1).optional(),
    frames: z.array(DemoVisualFrameRequestSchema).default([]),
    outputDir: z.string().min(1).optional(),
    outputPath: z.string().min(1).optional(),
    mode: z.enum(["compare", "update"]).default("compare"),
    pixelmatchThreshold: z.number().min(0).max(1).default(0.1),
    maxMismatchPercent: z.number().min(0).max(1).default(0.001),
    warnMismatchPercent: z.number().min(0).max(1).optional(),
    missingBaselineStatus: VisualGateStatusSchema.default("skip"),
  })
  .refine(
    (input) =>
      input.frames.length > 0 || Boolean(input.baselineDir && input.currentDir),
    {
      message: "frames or baselineDir/currentDir is required",
    },
  )
  .refine(
    (input) =>
      Boolean(input.baselineDir) ||
      input.frames.every((frame) => Boolean(frame.baselineFramePath)),
    {
      message: "baselineDir or frames[].baselineFramePath is required",
    },
  );

export const PackageReviewPromptRequestSchema = VideoIntakeRequestSchema.extend(
  {
    specPath: z.string().min(1).optional(),
    focus: z.array(z.string()).default([]),
  },
);

export type SkillCatalogRequest = z.infer<typeof SkillCatalogRequestSchema>;
export type InstallSkillPackRequest = z.infer<
  typeof InstallSkillPackRequestSchema
>;
export type VideoIntakeRequest = z.infer<typeof VideoIntakeRequestSchema>;
export type ReviewBundleRequest = z.infer<typeof ReviewBundleRequestSchema>;
export type StoryboardExtractRequest = z.infer<
  typeof StoryboardExtractRequestSchema
>;
export type VideoShotsRequest = z.infer<typeof VideoShotsRequestSchema>;
export type SourceMediaSignalsRequest = z.infer<
  typeof SourceMediaSignalsRequestSchema
>;
export type SegmentEvidenceRequest = z.infer<
  typeof SegmentEvidenceRequestSchema
>;
export type SegmentStoryboardRequest = z.infer<
  typeof SegmentStoryboardRequestSchema
>;
export type StoryboardOcrRequest = z.infer<typeof StoryboardOcrRequestSchema>;
export type StoryboardUnderstandRequest = z.infer<
  typeof StoryboardUnderstandRequestSchema
>;
export type StoryboardTransitionsRequest = z.infer<
  typeof StoryboardTransitionsRequestSchema
>;
export type LayoutSafetyReviewRequest = z.infer<
  typeof LayoutSafetyReviewRequestSchema
>;
export type VideoTechnicalReviewRequest = z.infer<
  typeof VideoTechnicalReviewRequestSchema
>;
export type CompareBundlesRequest = z.infer<typeof CompareBundlesRequestSchema>;
export type GoldenFrameCompareRequest = z.infer<
  typeof GoldenFrameCompareRequestSchema
>;
export type DemoVisualFrameRequest = z.infer<
  typeof DemoVisualFrameRequestSchema
>;
export type DemoVisualReviewRequest = z.infer<
  typeof DemoVisualReviewRequestSchema
>;
export type PackageReviewPromptRequest = z.infer<
  typeof PackageReviewPromptRequestSchema
>;
