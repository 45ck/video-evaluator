#!/usr/bin/env node
import {
  CompareBundlesRequestSchema,
  InstallSkillPackRequestSchema,
  PackageReviewPromptRequestSchema,
  ReviewBundleRequestSchema,
  SegmentEvidenceRequestSchema,
  SegmentStoryboardRequestSchema,
  SkillCatalogRequestSchema,
  StoryboardExtractRequestSchema,
  VideoShotsRequestSchema,
  StoryboardOcrRequestSchema,
  StoryboardTransitionsRequestSchema,
  StoryboardUnderstandRequestSchema,
  LayoutSafetyReviewRequestSchema,
  VideoTechnicalReviewRequestSchema,
  VideoIntakeRequestSchema,
  compareBundles,
  inferStoryboardTransitions,
  installSkillPack,
  listSkillCatalog,
  packageReviewPrompt,
  reviewBundle,
  runHarnessTool,
  runSegmentEvidence,
  runSegmentStoryboard,
  runStoryboardExtract,
  runVideoShots,
  runStoryboardOcr,
  runStoryboardTransitions,
  runStoryboardUnderstand,
  runLayoutSafetyReview,
  runVideoTechnicalReview,
  runVideoIntake,
} from "../dist/index.js";

const toolName = process.argv[2];

const registry = {
  "skill-catalog": {
    tool: "video-evaluator/skill-catalog",
    inputSchema: SkillCatalogRequestSchema,
    handler: async ({ input }) => listSkillCatalog(input),
  },
  "install-skill-pack": {
    tool: "video-evaluator/install-skill-pack",
    inputSchema: InstallSkillPackRequestSchema,
    handler: async ({ input }) => installSkillPack(input),
  },
  "video-intake": {
    tool: "video-evaluator/video-intake",
    inputSchema: VideoIntakeRequestSchema,
    handler: async ({ input }) => runVideoIntake(input),
  },
  "video-artifact-intake": {
    tool: "video-evaluator/video-artifact-intake",
    inputSchema: VideoIntakeRequestSchema,
    handler: async ({ input }) => runVideoIntake(input),
  },
  "review-bundle": {
    tool: "video-evaluator/review-bundle",
    inputSchema: ReviewBundleRequestSchema,
    handler: async ({ input }) => reviewBundle(input),
  },
  "storyboard-extract": {
    tool: "video-evaluator/storyboard-extract",
    inputSchema: StoryboardExtractRequestSchema,
    handler: async ({ input }) => runStoryboardExtract(input),
  },
  "video-shots": {
    tool: "video-evaluator/video-shots",
    inputSchema: VideoShotsRequestSchema,
    handler: async ({ input }) => runVideoShots(input),
  },
  "segment-evidence": {
    tool: "video-evaluator/segment-evidence",
    inputSchema: SegmentEvidenceRequestSchema,
    handler: async ({ input }) => runSegmentEvidence(input),
  },
  "segment-storyboard": {
    tool: "video-evaluator/segment-storyboard",
    inputSchema: SegmentStoryboardRequestSchema,
    handler: async ({ input }) => runSegmentStoryboard(input),
  },
  "storyboard-ocr": {
    tool: "video-evaluator/storyboard-ocr",
    inputSchema: StoryboardOcrRequestSchema,
    handler: async ({ input }) => runStoryboardOcr(input),
  },
  "storyboard-understand": {
    tool: "video-evaluator/storyboard-understand",
    inputSchema: StoryboardUnderstandRequestSchema,
    handler: async ({ input }) => runStoryboardUnderstand(input),
  },
  "storyboard-transitions": {
    tool: "video-evaluator/storyboard-transitions",
    inputSchema: StoryboardTransitionsRequestSchema,
    handler: async ({ input }) => runStoryboardTransitions(input),
  },
  "layout-safety-review": {
    tool: "video-evaluator/layout-safety-review",
    inputSchema: LayoutSafetyReviewRequestSchema,
    handler: async ({ input }) => runLayoutSafetyReview(input),
  },
  "video-technical-review": {
    tool: "video-evaluator/video-technical-review",
    inputSchema: VideoTechnicalReviewRequestSchema,
    handler: async ({ input }) => runVideoTechnicalReview(input),
  },
  "compare-bundles": {
    tool: "video-evaluator/compare-bundles",
    inputSchema: CompareBundlesRequestSchema,
    handler: async ({ input }) => compareBundles(input),
  },
  "compare-video-runs": {
    tool: "video-evaluator/compare-video-runs",
    inputSchema: CompareBundlesRequestSchema,
    handler: async ({ input }) => compareBundles(input),
  },
  "package-review-prompt": {
    tool: "video-evaluator/package-review-prompt",
    inputSchema: PackageReviewPromptRequestSchema,
    handler: async ({ input }) => packageReviewPrompt(input),
  },
};

if (!toolName || !(toolName in registry)) {
  const supported = Object.keys(registry).sort().join(", ");
  process.stderr.write(`Expected a supported tool name.\nSupported tools: ${supported}\n`);
  process.exit(1);
}

await runHarnessTool(registry[toolName]);
