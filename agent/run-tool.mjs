#!/usr/bin/env node
import {
  CompareBundlesRequestSchema,
  InstallSkillPackRequestSchema,
  PackageReviewPromptRequestSchema,
  ReviewBundleRequestSchema,
  SkillCatalogRequestSchema,
  StoryboardExtractRequestSchema,
  VideoIntakeRequestSchema,
  compareBundles,
  installSkillPack,
  listSkillCatalog,
  packageReviewPrompt,
  reviewBundle,
  runHarnessTool,
  runStoryboardExtract,
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
  "compare-bundles": {
    tool: "video-evaluator/compare-bundles",
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
